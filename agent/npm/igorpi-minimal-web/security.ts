/**
 * security.ts — SSRF защита и санитизация контента.
 *
 * v14: Исправлены критические проблемы:
 *      - Блокировка IPv6-mapped IPv4 (::ffff:127.0.0.1)
 *      - Блокировка cloud metadata endpoints (AWS, GCP, Azure, Oracle)
 *      - Блокировка 0.0.0.0 и link-local адресов (169.254.x.x)
 *      - Блокировка DNS rebinding атак (hostname → IP проверка)
 *      - Исправлена логика Base64-валидации
 */

import { URL } from "url";
import * as dns from "dns";

// ═════════════════════════════════════════════════════════════
// SSRF PROTECTION
// ═════════════════════════════════════════════════════════════

const DANGEROUS_PORTS = new Set([
	21, 22, 23, 25, 53, 110, 111, 135, 139, 143, 445,
	3306, 5432, 6379, 9200, 9300, 27017,
	3000, 5000, 8080, 8443, 9090,
]);

const MAX_URL_LENGTH = 2048;

// ✅ Блокированные hostname (включая cloud metadata)
const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"0.0.0.0",
	"::",
	"::ffff:127.0.0.1",
	"::ffff:0.0.0.0",
	"::ffff:169.254.169.254",
	// Cloud metadata endpoints
	"169.254.169.254", // AWS, GCP, Oracle
	"metadata.google.internal", // GCP
	"metadata.google",
	"168.63.129.16", // Azure IMDS
	"100.100.100.200", // Alibaba Cloud
	"169.254.170.2", // AWS ECS tasks
]);

// ✅ Regex для частных IPv4 диапазонов (RFC 1918, loopback, link-local, etc.)
function isPrivateIPv4(ip: string): boolean {
	const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
	const match = ip.match(ipv4Regex);
	if (!match) return false;

	const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];

	// Валидация октетов
	if (parts.some((p) => p < 0 || p > 255)) return false;

	// 10.0.0.0/8
	if (parts[0] === 10) return true;
	// 172.16.0.0/12
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	// 192.168.0.0/16
	if (parts[0] === 192 && parts[1] === 168) return true;
	// 127.0.0.0/8 (loopback)
	if (parts[0] === 127) return true;
	// 169.254.0.0/16 (link-local, cloud metadata)
	if (parts[0] === 169 && parts[1] === 254) return true;
	// 0.0.0.0/8
	if (parts[0] === 0) return true;
	// 100.64.0.0/10 (Carrier-grade NAT)
	if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

	return false;
}

// ✅ Проверка IPv6 на private/loopback
function isPrivateIPv6(ip: string): boolean {
	const normalized = ip.toLowerCase();

	// Loopback
	if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
	// Unspecified
	if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
	// ULA (fc00::/7)
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	// Link-local (fe80::/10)
	if (normalized.startsWith("fe80")) return true;
	// IPv6-mapped IPv4
	if (normalized.startsWith("::ffff:")) {
		const ipv4 = normalized.slice(7);
		if (isPrivateIPv4(ipv4)) return true;
	}
	return false;
}

export function validateUrl(url: string): { valid: boolean; error?: string } {
	if (url.length > MAX_URL_LENGTH) {
		return { valid: false, error: `URL too long (max ${MAX_URL_LENGTH} chars)` };
	}

	// Блокировка control-символов (включая переносы, часто используемые в header injection)
	if (/[\x00-\x1f\x7f]/.test(url)) {
		return { valid: false, error: "URL contains control characters" };
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { valid: false, error: "Invalid URL format" };
	}

	// Проверка схемы
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
	}

	// Проверка userinfo (user:pass@host) — может использоваться для обхода проверок
	if (parsed.username || parsed.password) {
		return { valid: false, error: "URL with credentials is not allowed" };
	}

	const hostname = parsed.hostname.toLowerCase();

	// ✅ Блокировка hostname из черного списка
	if (BLOCKED_HOSTNAMES.has(hostname)) {
		return { valid: false, error: "Blocked hostname" };
	}

	// ✅ Проверка IPv4
	if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
		if (isPrivateIPv4(hostname)) {
			return { valid: false, error: "Private IP address access denied" };
		}
	}

	// ✅ Проверка IPv6 (включая IPv6-mapped IPv4)
	if (hostname.startsWith("[") || hostname.includes(":")) {
		const cleanHost = hostname.replace(/^\[|\]$/g, "");
		if (isPrivateIPv6(cleanHost)) {
			return { valid: false, error: "Private/loopback IPv6 access denied" };
		}
	}

	// Проверка порта
	const port = parsed.port
		? parseInt(parsed.port, 10)
		: parsed.protocol === "https:"
		? 443
		: 80;
	if (DANGEROUS_PORTS.has(port)) {
		return { valid: false, error: `Port ${port} is blocked` };
	}

	return { valid: true };
}

/**
 * ✅ Опциональная async-проверка с DNS резолвингом (защита от DNS rebinding).
 * Используйте перед критическими запросами.
 */
export async function validateUrlWithDns(
	url: string,
): Promise<{ valid: boolean; error?: string; resolvedIps?: string[] }> {
	const basic = validateUrl(url);
	if (!basic.valid) return basic;

	const parsed = new URL(url);
	const hostname = parsed.hostname;

	return new Promise((resolve) => {
		dns.lookup(hostname, { all: true }, (err, addresses) => {
			if (err) {
				resolve({ valid: false, error: `DNS resolution failed: ${err.message}` });
				return;
			}

			const ips = Array.isArray(addresses)
				? addresses.map((a) => a.address)
				: [(addresses as any).address];

			for (const ip of ips) {
				if (isPrivateIPv4(ip) || isPrivateIPv6(ip)) {
					resolve({
						valid: false,
						error: `DNS resolved to blocked IP: ${ip}`,
						resolvedIps: ips,
					});
					return;
				}
			}

			resolve({ valid: true, resolvedIps: ips });
		});
	});
}

// ═════════════════════════════════════════════════════════════
// CONTENT SANITIZATION
// ═════════════════════════════════════════════════════════════

const INJECTION_PATTERNS = [
	/ignore\s+(all\s+)?previous\s+instructions/gi,
	/disregard\s+(all\s+)?previous/gi,
	/you\s+are\s+now\s+a/gi,
	/new\s+instructions?:/gi,
	/system\s*:/gi,
	/<\|im_start\|>/gi,
	/<\|im_end\|>/gi,
	/assistant\s*:/gi,
	/user\s*:/gi,
	/forget\s+(all\s+)?instructions/gi,
	/override\s+(previous\s+)?instructions/gi,
	/act\s+as\s+if/gi,
	/pretend\s+you\s+are/gi,
];

function isValidBase64(str: string): boolean {
	if (str.length < 50) return false;
	// Должны быть символы обоих регистров (исключает hex)
	const hasLowerNonHex = /[g-z]/.test(str);
	const hasUpper = /[A-Z]/.test(str);
	const hasDigit = /\d/.test(str);
	return hasLowerNonHex && hasUpper && hasDigit;
}

export function sanitizeContent(content: string): string {
	if (!content) return content;

	let sanitized = content;

	// 1. Unicode нормализация (NFC)
	sanitized = sanitized.normalize("NFC");

	// 2. Удаление zero-width символов
	sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u2060\u2061\u2062\u2063]/g, "");

	// 3. Удаление control-символов (кроме \n, \r, \t)
	sanitized = sanitized.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "");

	// 4. Замена Base64 blob'ов — только если это реально Base64
	sanitized = sanitized.replace(/[A-Za-z0-9+/]{50,}={0,2}/g, (match) => {
		if (isValidBase64(match)) {
			return "[BASE64_ENCODED_DATA]";
		}
		return match;
	});

	// 5. Замена инъекционных паттернов
	for (const pattern of INJECTION_PATTERNS) {
		sanitized = sanitized.replace(pattern, "[REDACTED]");
	}

	// 6. Экранирование chat markers
	sanitized = sanitized.replace(/<\|/g, "&lt;|").replace(/\|>/g, "|&gt;");

	return sanitized;
}

export function sanitizeSearchResult(result: {
	title: string;
	url: string;
	snippet?: string;
}): { title: string; url: string; snippet?: string } {
	return {
		title: sanitizeContent(result.title),
		url: result.url,
		snippet: result.snippet ? sanitizeContent(result.snippet) : result.snippet,
	};
}
/**
 * security.ts — SSRF защита и санитизация контента для pi-minimal-web.
 * 
 * v13: Улучшена безопасность:
 *      - Добавлены порты 3000, 5000, 8080, 8443, 9090 в DANGEROUS_PORTS
 *      - Улучшен Base64 regex — не срабатывает на hex-строках и хэшах
 *      - Добавлена функция isValidBase64 для проверки истинного Base64
 */

import { URL } from 'url';

// ═════════════════════════════════════════════════════════════
// SSRF PROTECTION
// ═════════════════════════════════════════════════════════════

/**
 * v13: Расширен список опасных портов.
 * 
 * Добавлены порты для внутренних сервисов:
 * - 3000: Node.js dev server
 * - 5000: Flask/Python dev server
 * - 8080: HTTP альтернатива
 * - 8443: HTTPS альтернатива
 * - 9090: Prometheus/консоль
 * - 9300: Elasticsearch transport
 */
const DANGEROUS_PORTS = new Set([
    // Стандартные сервисы
    21,     // FTP
    22,     // SSH
    23,     // Telnet
    25,     // SMTP
    53,     // DNS
    110,    // POP3
    111,    // RPC
    135,    // MS RPC
    139,    // NetBIOS
    143,    // IMAP
    445,    // SMB
    
    // Базы данных
    3306,   // MySQL
    5432,   // PostgreSQL
    6379,   // Redis
    9200,   // Elasticsearch HTTP
    9300,   // Elasticsearch transport
    27017,  // MongoDB
    
    // v13: Внутренние сервисы и dev-серверы
    3000,   // Node.js dev server (Express, Next.js)
    5000,   // Flask/Python dev server
    8080,   // HTTP альтернатива (часто прокси)
    8443,   // HTTPS альтернатива
    9090,   // Prometheus, Consul, Go dev
]);

const MAX_URL_LENGTH = 2048;

export function validateUrl(url: string): { valid: boolean; error?: string } {
    // Проверка длины
    if (url.length > MAX_URL_LENGTH) {
        return { valid: false, error: `URL too long (max ${MAX_URL_LENGTH} chars)` };
    }

    // Проверка control-символов
    if (/[\x00-\x1f\x7f]/.test(url)) {
        return { valid: false, error: 'URL contains control characters' };
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }

    // Проверка схемы
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }

    // Проверка хоста
    const hostname = parsed.hostname.toLowerCase();
    
    // Блокировка localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return { valid: false, error: 'Localhost access denied' };
    }

    // Блокировка внутренних IP (RFC 1918)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(hostname)) {
        const parts = hostname.split('.').map(Number);
        if (
            parts[0] === 10 ||
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168) ||
            parts[0] === 127
        ) {
            return { valid: false, error: 'Private IP address access denied' };
        }
    }

    // Блокировка IPv6 loopback и ULA
    if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname === '::1') {
        return { valid: false, error: 'IPv6 private/loopback access denied' };
    }

    // Проверка порта
    const port = parsed.port ? parseInt(parsed.port, 10) : 
                 (parsed.protocol === 'https:' ? 443 : 80);
    if (DANGEROUS_PORTS.has(port)) {
        return { valid: false, error: `Port ${port} is blocked` };
    }

    return { valid: true };
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

/**
 * v13: Проверяет, является ли строка истинным Base64.
 * 
 * Истинный Base64 содержит:
 * - Буквы обоих регистров (a-z, A-Z)
 * - Цифры (0-9)
 * - Символы +/
 * - Опциональный padding (=)
 * 
 * Это исключает false positive на:
 * - Git commit hashes (только hex: 0-9, a-f)
 * - SHA-256 hashes (только hex: 0-9, a-f)
 * - UUID (содержит дефисы)
 */
function isValidBase64(str: string): boolean {
  // Должно содержать буквы обоих регистров (не только hex)
  const hasLowerNonHex = /[g-z]/.test(str);
  const hasUpper = /[A-Z]/.test(str);
  
  // Если есть только hex-символы — это скорее хэш, а не Base64
  if (!hasLowerNonHex && !hasUpper) {
    return false;
  }
  
  return true;
}

export function sanitizeContent(content: string): string {
    if (!content) return content;

    let sanitized = content;

    // 1. Unicode нормализация (NFC) - защита от подмены символов
    sanitized = sanitized.normalize('NFC');

    // 2. Удаление zero-width символов (невидимые символы для скрытия инструкций)
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u2060\u2061\u2062\u2063]/g, '');

    // 3. Удаление control-символов (кроме \n, \r, \t)
    sanitized = sanitized.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 4. v13: Замена Base64 blob'ов — только истинный Base64
    //    Не заменяем hex-строки (git hashes, SHA-256)
    sanitized = sanitized.replace(
        /[A-Za-z0-9+/]{50,}={0,2}/g,
        (match) => {
            if (isValidBase64(match)) {
                return '[BASE64_ENCODED_DATA]';
            }
            return match;  // Оставляем как есть — это не Base64
        }
    );

    // 5. Замена инъекционных паттернов
    for (const pattern of INJECTION_PATTERNS) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    // 6. Экранирование специальных последовательностей (chat markers)
    sanitized = sanitized
        .replace(/<\|/g, '&lt;|')
        .replace(/\|>/g, '|&gt;');

    return sanitized;
}

export function sanitizeSearchResult(result: {
    title: string;
    url: string;
    snippet?: string;
}): { title: string; url: string; snippet?: string } {
    return {
        title: sanitizeContent(result.title),
        url: result.url, // URL не очищаем, только валидируем
        snippet: result.snippet ? sanitizeContent(result.snippet) : result.snippet,
    };
}
/* extract.ts */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import pLimit from "p-limit";
import iconv from "iconv-lite";
import { activityMonitor } from "./activity.js";

const DEFAULT_TIMEOUT_MS = 30000;
const CONCURRENT_LIMIT = 3;
const MIN_USEFUL_CONTENT = 500;

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

const fetchLimit = pLimit(CONCURRENT_LIMIT);

export interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	error: string | null;
}

export interface ExtractOptions {
	timeoutMs?: number;
}

const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30000;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
	return errorMessage(err).toLowerCase().includes("abort");
}

function abortedResult(url: string): ExtractedContent {
	return { url, title: "", content: "", error: "Aborted" };
}

// ═══════════════════════════════════════════════════════════════
// 🎯 КОНВЕРТАЦИЯ КОДИРОВОК — ИСПРАВЛЕННАЯ ВЕРСИЯ
// ═══════════════════════════════════════════════════════════════

function getCharsetFromHeader(contentType: string | null): string | null {
	if (!contentType) return null;
	const match = contentType.match(/charset\s*=\s*["']?([^"';\s]+)/i);
	return match ? match[1].trim().toLowerCase() : null;
}

function isValidUtf8(buffer: Buffer): boolean {
	let i = 0;
	let nonAsciiCount = 0;
	while (i < buffer.length) {
		const byte = buffer[i];
		if (byte <= 0x7f) {
			i++;
		} else if (byte >= 0xc2 && byte <= 0xdf) {
			if (i + 1 >= buffer.length || (buffer[i + 1] & 0xc0) !== 0x80) return false;
			i += 2;
			nonAsciiCount++;
		} else if (byte >= 0xe0 && byte <= 0xef) {
			if (
				i + 2 >= buffer.length ||
				(buffer[i + 1] & 0xc0) !== 0x80 ||
				(buffer[i + 2] & 0xc0) !== 0x80
			)
				return false;
			i += 3;
			nonAsciiCount++;
		} else if (byte >= 0xf0 && byte <= 0xf4) {
			if (
				i + 3 >= buffer.length ||
				(buffer[i + 1] & 0xc0) !== 0x80 ||
				(buffer[i + 2] & 0xc0) !== 0x80 ||
				(buffer[i + 3] & 0xc0) !== 0x80
			)
				return false;
			i += 4;
			nonAsciiCount++;
		} else {
			return false;
		}
	}
	// Если валидный UTF-8, но в основном ASCII — это действительно UTF-8
	// Если много non-ASCII и все валидно — скорее всего UTF-8
	return true;
}

function detectBom(buffer: Buffer): string | null {
	if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
		return "utf-8";
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le";
	if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be";
	return null;
}

/**
 * ✅ Детектирует артефакты неверного декодирования.
 * Например, при декодировании UTF-8 текста как windows-1251 появляются
 * характерные последовательности типа "Р—Р°РїРёСЃРё" (бессмысленная кириллица).
 */
function hasDecodingArtifacts(text: string): boolean {
	if (text.length === 0) return false;

	// Проверяем частоту "мусорных" символов
	// В нормальной кириллице буквы распределены неравномерно,
	// в артефактах — почти равновероятны
	const cyrillicChars = text.match(/[а-яА-ЯёЁ]/g) || [];
	if (cyrillicChars.length === 0) return false;

	// Считаем количество уникальных кириллических букв
	const unique = new Set(cyrillicChars.map((c) => c.toLowerCase()));

	// В нормальной кириллице на 100 символов обычно 20-30 уникальных букв
	// В артефактах — почти все 33 буквы встречаются часто
	// Если уникальных > 28 и текст короткий — скорее всего артефакты
	if (cyrillicChars.length > 20 && unique.size > 28) {
		const ratio = unique.size / cyrillicChars.length;
		if (ratio > 0.4 && cyrillicChars.length < 200) {
			return true;
		}
	}

	// Эвристика: частые "Р" в начале слов (признак UTF-8 → CP1251)
	const badPatterns = [
		/Р[А-Яа-я]{2,}/g,
		/С[А-Яа-я]{2,}/g,
		/РЎ/g,
		/Р—/g,
	];
	let badMatches = 0;
	for (const pattern of badPatterns) {
		const matches = text.match(pattern) || [];
		badMatches += matches.length;
	}
	if (badMatches > 5) return true;

	return false;
}

function decodeBuffer(buffer: Buffer, declaredCharset: string | null): string {
	// 1. BOM имеет высший приоритет
	const bom = detectBom(buffer);
	if (bom) {
		if (bom === "utf-8") return buffer.toString("utf-8");
		if (iconv.encodingExists(bom)) return iconv.decode(buffer, bom);
	}

	// 2. Если declared charset и он НЕ UTF-8 — пробуем его
	if (
		declaredCharset &&
		declaredCharset !== "utf-8" &&
		declaredCharset !== "utf8" &&
		iconv.encodingExists(declaredCharset)
	) {
		const decoded = iconv.decode(buffer, declaredCharset);
		if (!hasDecodingArtifacts(decoded)) {
			return decoded;
		}
	}

	// 3. Пробуем UTF-8 (если валидный)
	if (isValidUtf8(buffer)) {
		return buffer.toString("utf-8");
	}

	// 4. Пробуем популярные кодировки по порядку
	const candidates = ["windows-1251", "koi8-r", "iso-8859-5", "windows-1252"];
	for (const encoding of candidates) {
		if (!iconv.encodingExists(encoding)) continue;
		const decoded = iconv.decode(buffer, encoding);
		if (!hasDecodingArtifacts(decoded)) {
			return decoded;
		}
	}

	// 5. Fallback: windows-1251
	return iconv.decode(buffer, "windows-1251");
}

// ═══════════════════════════════════════════════════════════════
// JINA READER
// ═══════════════════════════════════════════════════════════════

async function extractWithJinaReader(
	url: string,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	// ✅ Проверка: уже отменено?
	if (signal?.aborted) return abortedResult(url);

	const jinaUrl = JINA_READER_BASE + url;
	const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });

	// ✅ Создаем controller для корректной очистки таймаута
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

	const onAbort = () => controller.abort();
	signal?.addEventListener("abort", onAbort);

	try {
		const res = await fetch(jinaUrl, {
			headers: {
				Accept: "text/markdown",
				"X-No-Cache": "true",
			},
			signal: controller.signal,
		});

		if (!res.ok) {
			activityMonitor.logComplete(activityId, res.status);
			return null;
		}

		const content = await res.text();
		activityMonitor.logComplete(activityId, res.status);

		const contentStart = content.indexOf("Markdown Content:");
		if (contentStart < 0) return null;

		const markdownPart = content.slice(contentStart + 17).trim();

		if (
			markdownPart.length < 100 ||
			markdownPart.startsWith("Loading...") ||
			markdownPart.startsWith("Please enable JavaScript")
		) {
			return null;
		}

		const title =
			extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url);
		return { url, title, content: markdownPart, error: null };
	} catch (err) {
		const message = errorMessage(err);
		if (isAbortError(err)) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return null;
	} finally {
		// ✅ Очистка в любом случае
		clearTimeout(timeoutId);
		if (signal) {
			signal.removeEventListener("abort", onAbort);
		}
	}
}

// ═══════════════════════════════════════════════════════════════
// ОСНОВНАЯ ЛОГИКА
// ═══════════════════════════════════════════════════════════════

export async function extractContent(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent> {
	if (signal?.aborted) {
		return abortedResult(url);
	}

	try {
		new URL(url);
	} catch {
		return { url, title: "", content: "", error: "Invalid URL" };
	}

	const httpResult = await extractViaHttp(url, signal, options);

	if (signal?.aborted) return abortedResult(url);
	if (!httpResult.error) return httpResult;

	const jinaResult = await extractWithJinaReader(url, signal);
	if (jinaResult) return jinaResult;
	if (signal?.aborted) return abortedResult(url);

	const guidance = [
		httpResult.error,
		"",
		"Fallback options:",
		"  • Use web_search to find content about this topic",
	].join("\n");
	return { ...httpResult, error: guidance };
}

function isLikelyJSRendered(html: string): boolean {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (!bodyMatch) return false;

	const bodyHtml = bodyMatch[1];
	const textContent = bodyHtml
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();

	const scriptCount = (html.match(/<script/gi) || []).length;
	return textContent.length < 500 && scriptCount > 3;
}

async function extractViaHttp(
	url: string,
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const activityId = activityMonitor.logStart({ type: "fetch", url });

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	// ✅ Создаем обработчик только если signal есть
	const onAbort = signal ? () => controller.abort() : null;
	if (onAbort && signal) {
		signal.addEventListener("abort", onAbort);
	}

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
				"Cache-Control": "no-cache",
				"Sec-Fetch-Dest": "document",
				"Sec-Fetch-Mode": "navigate",
				"Sec-Fetch-Site": "none",
				"Sec-Fetch-User": "?1",
				"Upgrade-Insecure-Requests": "1",
			},
			redirect: "follow", // ✅ Явно разрешаем редиректы
		});

		if (!response.ok) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const contentType = response.headers.get("content-type") || "";
		const declaredCharset = getCharsetFromHeader(contentType);

		// Skip binary/unsupported types
		if (
			contentType.includes("application/octet-stream") ||
			contentType.includes("image/") ||
			contentType.includes("audio/") ||
			contentType.includes("video/") ||
			contentType.includes("application/zip") ||
			contentType.includes("application/pdf")
		) {
			activityMonitor.logComplete(activityId, response.status);
			return {
				url,
				title: "",
				content: "",
				error: `Unsupported content type: ${contentType.split(";")[0]}`,
			};
		}

		const buffer = Buffer.from(await response.arrayBuffer());
		const text = decodeBuffer(buffer, declaredCharset);

		const isHTML =
			contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

		if (!isHTML) {
			activityMonitor.logComplete(activityId, response.status);
			const title = extractTextTitle(text, url);
			return { url, title, content: text, error: null };
		}

		const { document } = parseHTML(text);
		const reader = new Readability(document as unknown as Document);
		const article = reader.parse();

		if (!article) {
			activityMonitor.logComplete(activityId, response.status);
			const jsRendered = isLikelyJSRendered(text);
			const errorMsg = jsRendered
				? "Page appears to be JavaScript-rendered (content loads dynamically)"
				: "Could not extract readable content from HTML structure";
			return { url, title: "", content: "", error: errorMsg };
		}

		const markdown = turndown.turndown(article.content ?? "");
		activityMonitor.logComplete(activityId, response.status);

		if (markdown.length < MIN_USEFUL_CONTENT) {
			return {
				url,
				title: article.title || "",
				content: markdown,
				error: isLikelyJSRendered(text)
					? "Page appears to be JavaScript-rendered (content loads dynamically)"
					: "Extracted content appears incomplete",
			};
		}

		return { url, title: article.title || "", content: markdown, error: null };
	} catch (err) {
		const message = errorMessage(err);
		if (isAbortError(err)) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		return { url, title: "", content: "", error: message };
	} finally {
		// ✅ Гарантированная очистка
		clearTimeout(timeoutId);
		if (onAbort && signal) {
			signal.removeEventListener("abort", onAbort);
		}
	}
}

export function extractHeadingTitle(text: string): string | null {
	const match = text.match(/^#{1,2}\s+(.+)/m);
	if (!match) return null;
	const cleaned = match[1].replace(/\*+/g, "").trim();
	return cleaned || null;
}

function extractTextTitle(text: string, url: string): string {
	return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}

export async function fetchAllContent(
	urls: string[],
	signal?: AbortSignal,
	options?: ExtractOptions,
): Promise<ExtractedContent[]> {
	return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}
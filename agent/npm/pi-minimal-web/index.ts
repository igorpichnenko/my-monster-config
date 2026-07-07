/* index.ts */
import type { ExtensionAPI, AgentToolUpdateCallback, MessageRenderOptions, ToolCallEvent, ToolResultEvent, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { fetchAllContent } from "./extract.js";
import { search } from "./exa.js";
import { validateUrl, sanitizeContent, sanitizeSearchResult } from "./security.js";

const DEFAULT_MAX_LENGTH = 1000;
const ABSOLUTE_MAX_LENGTH = 10000;

const GUIDANCE_WEB_SEARCH = (numResults: number) => `
⚠️ web_search: ты вызвал с numResults=${numResults}, но это слишком много.

Best practices:
- Начинай с numResults: 2
- Увеличивай постепенно: 2 → 3 → 5 (максимум)
- Используй offset для пагинации

ПОВТОРИ вызов web_search с numResults: 2
`;

const GUIDANCE_FETCH_CONTENT_INITIAL = (maxLength: number) => `
⚠️ web_get: ты вызвал с maxLength=${maxLength}, но это слишком много.

Best practices:
- Начинай с maxLength: 1000
- Увеличивай только если контент обрезан (видишь "X/Y chars shown" где X < Y)
- Используй offset для чтения следующих чанков

ПОНЯТИЕ "(X/Y) chars shown":
- X = Y → весь контент получен, НЕ нужно больше вызовов
- X < Y → есть ещё контент, используй offset: X

ПОВТОРИ вызов web_get с maxLength: 1000
`;

const GUIDANCE_FETCH_CONTENT_OFFSET = (maxLength: number, offset?: number) => `
⚠️ web_get: ты вызвал с maxLength=${maxLength}${offset ? `, offset=${offset}` : ""}, но это неправильный подход.

Если контент обрезан (видишь "X/Y chars shown" где X < Y), НЕ увеличивай maxLength!
Вместо этого используй offset для чтения следующих чанков:

Пример:
1. web_get({url: "...", maxLength: 1000}) → получил (1000/5000) — есть ещё контент
2. web_get({url: "...", maxLength: 1000, offset: 1000}) → получил следующие 1000 символов
3. web_get({url: "...", maxLength: 1000, offset: 2000}) → продолжение

ПОНЯТИЕ "(X/Y) chars shown":
- X = Y → весь контент получен, НЕ нужно больше вызовов
- X < Y → есть ещё контент, используй offset: X

ПОВТОРИ вызов web_get с maxLength: 1000 и правильным offset
`;

const GUIDANCE_FETCH_CONTENT_NO_MORE = (offset: number) => `
⚠️ web_get: ты вызвал с offset=${offset}, но в предыдущем вызове ты получил ВЕСЬ контент.

Если ты видишь "(X/X) chars shown" где числа одинаковые — это означает, что весь контент получен.
НЕ нужно использовать offset или увеличивать maxLength.

Переходи к следующему шагу задачи.
`;

// Отслеживаем состояние для каждого инструмента
let warnedTools = new Map<string, {
  count: number;
  lastMaxLength?: number;
  lastOffset?: number;
  lastReturnedLength?: number;
  lastTotalLength?: number;
  consecutiveCorrectCalls: number; // счётчик правильных вызовов подряд
}>();

const CORRECT_CALLS_THRESHOLD = 3; // после 3 правильных вызовов — отключаем блокировки
const CONTENT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONTENT_CACHE_SIZE = 20;

const DEFAULT_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 5;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_SIZE = 10;

// ✅ Период очистки кэша (вместо случайного Math.random)
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 минута

interface CachedContent {
	url: string;
	title: string;
	fullContent: string;
	fetchedAt: number;
}

const contentCache = new Map<string, CachedContent>();

function getCacheKey(url: string): string {
	return url.toLowerCase().trim();
}

function getCachedContent(url: string): CachedContent | null {
	const key = getCacheKey(url);
	const cached = contentCache.get(key);
	if (!cached) return null;
	if (Date.now() - cached.fetchedAt > CONTENT_CACHE_TTL_MS) {
		contentCache.delete(key);
		return null;
	}
	return cached;
}

function setCachedContent(url: string, title: string, content: string): void {
	const key = getCacheKey(url);
	if (contentCache.size >= MAX_CONTENT_CACHE_SIZE) {
		const oldestKey = contentCache.keys().next().value;
		if (oldestKey) contentCache.delete(oldestKey);
	}
	contentCache.set(key, {
		url,
		title,
		fullContent: content,
		fetchedAt: Date.now(),
	});
}

function clearExpiredContentCache(): void {
	const now = Date.now();
	for (const [key, value] of contentCache.entries()) {
		if (now - value.fetchedAt > CONTENT_CACHE_TTL_MS) {
			contentCache.delete(key);
		}
	}
}

interface CachedSearch {
	query: string;
	numResults: number;
	answer: string;
	results: Array<{ title: string; url: string; snippet?: string }>;
	fetchedAt: number;
}

const searchCache = new Map<string, CachedSearch>();

function getSearchCacheKey(query: string, numResults: number): string {
	return `${query.toLowerCase().trim()}|${numResults}`;
}

function getCachedSearch(query: string, numResults: number): CachedSearch | null {
	const key = getSearchCacheKey(query, numResults);
	const cached = searchCache.get(key);
	if (!cached) return null;
	if (Date.now() - cached.fetchedAt > SEARCH_CACHE_TTL_MS) {
		searchCache.delete(key);
		return null;
	}
	return cached;
}

function setCachedSearch(
	query: string,
	numResults: number,
	answer: string,
	results: Array<{ title: string; url: string; snippet?: string }>,
): void {
	const key = getSearchCacheKey(query, numResults);
	if (searchCache.size >= MAX_SEARCH_CACHE_SIZE) {
		const oldestKey = searchCache.keys().next().value;
		if (oldestKey) searchCache.delete(oldestKey);
	}
	searchCache.set(key, {
		query,
		numResults,
		answer,
		results,
		fetchedAt: Date.now(),
	});
}

function clearExpiredSearchCache(): void {
	const now = Date.now();
	for (const [key, value] of searchCache.entries()) {
		if (now - value.fetchedAt > SEARCH_CACHE_TTL_MS) {
			searchCache.delete(key);
		}
	}
}

// ✅ Функции для управления периодической очисткой
let cleanupIntervalId: NodeJS.Timeout | null = null;

function startCacheCleanup(): void {
	if (cleanupIntervalId) return;
	cleanupIntervalId = setInterval(() => {
		clearExpiredContentCache();
		clearExpiredSearchCache();
	}, CACHE_CLEANUP_INTERVAL_MS);

	// ✅ Позволяет процессу завершиться, не дожидаясь интервала
	if (cleanupIntervalId && typeof cleanupIntervalId.unref === "function") {
		cleanupIntervalId.unref();
	}
}

function stopCacheCleanup(): void {
	if (cleanupIntervalId) {
		clearInterval(cleanupIntervalId);
		cleanupIntervalId = null;
	}
}

function findSmartCutPoint(text: string, maxLength: number): number {
	if (text.length <= maxLength) return text.length;
	const beforeLimit = text.slice(0, maxLength);
	const lastParagraph = beforeLimit.lastIndexOf("\n\n");
	if (lastParagraph > maxLength * 0.8) return lastParagraph;
	const lastSentence = Math.max(
		beforeLimit.lastIndexOf(". "),
		beforeLimit.lastIndexOf(".\n"),
		beforeLimit.lastIndexOf("! "),
		beforeLimit.lastIndexOf("? "),
	);
	if (lastSentence > maxLength * 0.7) return lastSentence + 1;
	const lastLine = beforeLimit.lastIndexOf("\n");
	if (lastLine > maxLength * 0.6) return lastLine;
	return maxLength;
}

export default function (pi: ExtensionAPI) {
	// ✅ Запускаем периодическую очистку кэша
	startCacheCleanup();

	// ✅ Регистрируем cleanup при завершении (если API поддерживает)
	if (typeof (pi as any).onShutdown === "function") {
		(pi as any).onShutdown(() => stopCacheCleanup());
	}

	// ═════════════════════════════════════════════════════════
	// WEB SEARCH GUIDANCE (отслеживание состояния для каждого инструмента)
	// ═════════════════════════════════════════════════════════
	pi.on("agent_start", () => {
		warnedTools.clear();
	});

	pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (event.toolName === "web_search") {
			const numResults = (event.input as any)?.numResults ?? 2;
			const state = warnedTools.get("web_search") ?? { count: 0, consecutiveCorrectCalls: 0 };
			
			// Правильный вызов
			if (numResults <= 2) {
				state.consecutiveCorrectCalls++;
				warnedTools.set("web_search", state);
				
				// Автообучение: если 3+ правильных вызовов подряд — отключаем проверки
				if (state.consecutiveCorrectCalls >= CORRECT_CALLS_THRESHOLD) {
					return; // пропускаем все проверки
				}
				return;
			}
			
			// Неправильный вызов — сбрасываем счётчик правильных
			state.consecutiveCorrectCalls = 0;
			
			// Если модель уже обучилась — пропускаем блокировку (но логируем)
			if (state.count > 0 && state.consecutiveCorrectCalls === 0) {
				// Уже показывали warning, но модель снова ошибается — блокируем
			}
			
			if (state.count === 0) {
				state.count++;
				warnedTools.set("web_search", state);
				
				ctx.ui.notify(`⚠️ web_search: numResults=${numResults} → блокирую, используй 2`, "warning");
				
				pi.sendMessage(
					{
						customType: "web-guidance",
						content: GUIDANCE_WEB_SEARCH(numResults),
						display: true,
					},
					{ triggerTurn: true }
				);
				
				return { block: true, reason: "web-guidance: numResults too high" };
			}
		}
		
		if (event.toolName === "web_get") {
			const maxLength = (event.input as any)?.maxLength ?? 1000;
			const offset = (event.input as any)?.offset ?? 0;
			
			const state = warnedTools.get("web_get") ?? { count: 0, consecutiveCorrectCalls: 0 };
			
			// Детектор: модель использует offset, но предыдущий вызов вернул весь контент
			if (offset > 0 && state.lastReturnedLength !== undefined && state.lastTotalLength !== undefined) {
				if (state.lastReturnedLength >= state.lastTotalLength) {
					state.count++;
					warnedTools.set("web_get", state);
					
					ctx.ui.notify(`⚠️ web_get: offset=${offset}, но весь контент уже получен!`, "warning");
					
					pi.sendMessage(
						{
							customType: "web-guidance",
							content: GUIDANCE_FETCH_CONTENT_NO_MORE(offset),
							display: true,
						},
						{ triggerTurn: true }
					);
					
					return { block: true, reason: "web-guidance: no more content, offset not needed" };
				}
			}
			
			// Правильный вызов
			if (maxLength <= 1000) {
				state.consecutiveCorrectCalls++;
				warnedTools.set("web_get", state);
				
				// Автообучение: если 3+ правильных вызовов подряд — отключаем проверки
				if (state.consecutiveCorrectCalls >= CORRECT_CALLS_THRESHOLD) {
					return; // пропускаем все проверки
				}
				return;
			}
			
			// Неправильный вызов — сбрасываем счётчик правильных
			state.consecutiveCorrectCalls = 0;
			
			// Детектор: модель увеличивает maxLength без offset
			if (state.lastMaxLength && maxLength > state.lastMaxLength && offset === 0) {
				state.count++;
				state.lastMaxLength = maxLength;
				state.lastOffset = offset;
				warnedTools.set("web_get", state);
				
				ctx.ui.notify(`⚠️ web_get: maxLength=${maxLength} → используй offset, не увеличивай maxLength!`, "warning");
				
				pi.sendMessage(
					{
						customType: "web-guidance",
						content: GUIDANCE_FETCH_CONTENT_OFFSET(maxLength, offset),
						display: true,
					},
					{ triggerTurn: true }
				);
				
				return { block: true, reason: "web-guidance: use offset instead of increasing maxLength" };
			}
			
			// Первый неправильный вызов
			if (state.count === 0) {
				state.count++;
				state.lastMaxLength = maxLength;
				state.lastOffset = offset;
				warnedTools.set("web_get", state);
				
				ctx.ui.notify(`⚠️ web_get: maxLength=${maxLength} → блокирую, используй 1000`, "warning");
				
				pi.sendMessage(
					{
						customType: "web-guidance",
						content: GUIDANCE_FETCH_CONTENT_INITIAL(maxLength),
						display: true,
					},
					{ triggerTurn: true }
				);
				
				return { block: true, reason: "web-guidance: maxLength too high" };
			}
		}
	});

	// Отслеживаем результаты вызовов
	pi.on("tool_result", (event: ToolResultEvent, _ctx: ExtensionContext) => {
		if (event.toolName === "web_get" && (event as any).details) {
			const details = (event as any).details as any;
			const state = warnedTools.get("web_get") ?? { count: 0, consecutiveCorrectCalls: 0 };
			
			state.lastReturnedLength = details.returnedLength;
			state.lastTotalLength = details.totalLength;
			warnedTools.set("web_get", state);
		}
	});

	// ═════════════════════════════════════════════════════════
	// WEB SEARCH
	// ═════════════════════════════════════════════════════════
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		promptSnippet: `Web search via Exa. web_search({query, numResults, offset})`,
		parameters: Type.Object({
			query: Type.String(),
			numResults: Type.Optional(Type.Number()),
			offset: Type.Optional(Type.Number()),
		}),

		async execute(_toolCallId: string, params: { query: string; numResults?: number; offset?: number; }, signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<any> | undefined, _ctx: any) {
			// ✅ Ранняя проверка abort
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Operation aborted" }],
					details: { error: "Aborted" },
				};
			}

			const query = params.query.trim();
			const numResults = Math.min(params.numResults ?? DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
			const offset = Math.max(0, params.offset ?? 0);

			if (!query) {
				return {
					content: [{ type: "text", text: "Error: Query is required" }],
					details: { error: "No query provided" },
				};
			}

			// ✅ Убрали Math.random() — очистка теперь через setInterval

			try {
				let answer: string = "";
				let allResults: Array<{ title: string; url: string; snippet?: string }> = [];
				let fromCache = false;

				if (offset === 0) {
					const cached = getCachedSearch(query, numResults);
					if (cached) {
						answer = cached.answer;
						allResults = cached.results;
						fromCache = true;
					}
				}

				if (!fromCache) {
					const requestNumResults = offset > 0 ? Math.min(numResults + offset, MAX_SEARCH_RESULTS) : numResults;

					const searchResult = await search(query, {
						numResults: requestNumResults,
						signal,
					});

					answer = searchResult.answer ? sanitizeContent(searchResult.answer) : "";
					allResults = searchResult.results.map(sanitizeSearchResult);

					if (offset === 0) {
						setCachedSearch(query, numResults, answer, allResults);
					}
				}

				const paginatedResults = allResults.slice(offset, offset + numResults);
				const hasMore = offset + numResults < allResults.length;

				if (paginatedResults.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `[No more results. Total: ${allResults.length} found.]`,
							},
						],
						details: {
							query,
							totalResults: allResults.length,
							offset,
							hasMore: false,
							fromCache,
						},
					};
				}

				let output = "";

				if (offset === 0 && answer) {
					output += `${answer}\n\n---\n\n`;
				}

				output += `**Sources** (${offset + 1}-${offset + paginatedResults.length} of ${allResults.length}):\n`;
				output += paginatedResults
					.map((r, i) => {
						const num = offset + i + 1;
						return `${num}. ${r.title}\n   ${r.url}`;
					})
					.join("\n\n");

				output += `\n\n---\n`;
				output += `${paginatedResults.length}/${allResults.length} shown`;
				if (fromCache) output += ` ⚡`;
				output += `\n`;

				if (hasMore) {
					const nextOffset = offset + numResults;
					output += `\n📖 More: ${allResults.length - nextOffset} results remaining\n`;
					output += `💡 To see more, call web_search with:\n`;
					output += `   query: "${query}"\n`;
					output += `   numResults: ${numResults}\n`;
					output += `   offset: ${nextOffset}\n`;
				}

				if (offset === 0) {
					output += `\n💡 To read a page, call web_get with:\n`;
					output += `   url: "<url_from_list_above>"\n`;
					output += `   maxLength: 1000\n`;
				}

				return {
					content: [{ type: "text", text: output }],
					details: {
						query,
						resultCount: paginatedResults.length,
						totalResults: allResults.length,
						offset,
						hasMore,
						fromCache,
						urls: paginatedResults.map((r) => r.url),
					},
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message, query },
				};
			}
		},

		renderCall(args: { query?: string; numResults?: number; offset?: number; }, theme: Theme) {
			const { query, numResults, offset } = args as {
				query?: string;
				numResults?: number;
				offset?: number;
			};
			const display = !query ? "(no query)" : query.length > 60 ? query.slice(0, 57) + "..." : query;
			const pageInfo = offset
				? ` [${offset}+${numResults ?? DEFAULT_SEARCH_RESULTS}]`
				: ` [${numResults ?? DEFAULT_SEARCH_RESULTS}]`;
			return new Text(
				theme.fg("toolTitle", theme.bold("search ")) +
					theme.fg("accent", `"${display}"`) +
					theme.fg("dim", pageInfo),
				0,
				0,
			);
		},

		renderResult(result: { content?: any[]; details?: any; }, { expanded }: { expanded?: boolean }, theme: Theme) {
			const details = result.details as {
				query?: string;
				resultCount?: number;
				totalResults?: number;
				error?: string;
				fromCache?: boolean;
			};
			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const cacheBadge = details?.fromCache ? theme.fg("success", " ⚡") : "";
			const statusLine =
				theme.fg("success", `${details?.resultCount ?? 0}/${details?.totalResults ?? 0}`) + cacheBadge;

			if (!expanded) return new Text(statusLine, 0, 0);

			const textContent = result.content?.find((c: any) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	} as any);

	// ═════════════════════════════════════════════════════════
	// FETCH CONTENT
	// ═════════════════════════════════════════════════════════
	pi.registerTool({
		name: "web_get",
		label: "Fetch Content",
		promptSnippet: `Fetch URL as markdown. web_get({url, maxLength, offset})`,
		parameters: Type.Object({
			url: Type.String(),
			maxLength: Type.Optional(Type.Number()),
			offset: Type.Optional(Type.Number()),
		}),

		async execute(_toolCallId: string, params: { url: string; maxLength?: number; offset?: number; }, signal: AbortSignal | undefined, _onUpdate: AgentToolUpdateCallback<any> | undefined, _ctx: any) {
			// ✅ Ранняя проверка abort
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Operation aborted" }],
					details: { error: "Aborted" },
				};
			}

			const { url } = params;
			const maxLength = Math.min(params.maxLength ?? DEFAULT_MAX_LENGTH, ABSOLUTE_MAX_LENGTH);
			const offset = Math.max(0, params.offset ?? 0);

			if (!url) {
				return {
					content: [{ type: "text", text: "Error: URL is required" }],
					details: { error: "No URL provided" },
				};
			}

			// SSRF PROTECTION
			const urlValidation = validateUrl(url);
			if (!urlValidation.valid) {
				return {
					content: [{ type: "text", text: `Error: ${urlValidation.error}` }],
					details: { error: urlValidation.error, url },
				};
			}

			try {
				let fullContent: string;
				let title: string;
				let fromCache = false;

				const cached = getCachedContent(url);
				if (cached) {
					fullContent = cached.fullContent;
					title = cached.title;
					fromCache = true;
				} else {
					const fetchResults = await fetchAllContent([url], signal);
					const result = fetchResults[0];

					if (result.error) {
						return {
							content: [{ type: "text", text: `Error: ${result.error}` }],
							details: { error: result.error, url },
						};
					}

					fullContent = sanitizeContent(result.content);
					title = sanitizeContent(result.title);
					setCachedContent(url, title, fullContent);
				}

				const totalLength = fullContent.length;

				if (offset >= totalLength) {
					return {
						content: [
							{
								type: "text",
								text: `[End of content. Total: ${totalLength} chars.]`,
							},
						],
						details: {
							url,
							title,
							totalLength,
							offset,
							returnedLength: 0,
							hasMore: false,
							fromCache,
						},
					};
				}

				const remaining = fullContent.slice(offset);
				const cutLength = Math.min(maxLength, remaining.length);
				const smartCut = findSmartCutPoint(remaining, cutLength);
				const returnedContent = remaining.slice(0, smartCut);
				const newOffset = offset + smartCut;
				const hasMore = newOffset < totalLength;

				let output = returnedContent;

				output += `\n\n---\n`;
				output += `${smartCut}/${totalLength} chars shown`;
				if (fromCache) output += ` ⚡`;
				output += `\n`;

				if (hasMore) {
					const remainingChars = totalLength - newOffset;
					output += `\n📖 More: ${remainingChars} chars remaining\n`;
					output += `💡 To read more, call web_get with:\n`;
					output += `   url: "${url}"\n`;
					output += `   maxLength: ${maxLength}\n`;
					output += `   offset: ${newOffset}\n`;
				}

				return {
					content: [{ type: "text", text: output }],
					details: {
						url,
						title,
						totalLength,
						offset,
						returnedLength: smartCut,
						newOffset,
						hasMore,
						maxLength,
						fromCache,
					},
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message, url },
				};
			}
		},

		renderCall(args: { url?: string; maxLength?: number; offset?: number; }, theme: Theme) {
			const { url, maxLength, offset } = args as {
				url?: string;
				maxLength?: number;
				offset?: number;
			};
			if (!url) {
				return new Text(
					theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"),
					0,
					0,
				);
			}
			const display = url.length > 50 ? url.slice(0, 47) + "..." : url;
			const pageInfo = offset
				? ` [${offset}+${maxLength ?? DEFAULT_MAX_LENGTH}]`
				: ` [${maxLength ?? DEFAULT_MAX_LENGTH}]`;
			return new Text(
				theme.fg("toolTitle", theme.bold("fetch ")) +
					theme.fg("accent", display) +
					theme.fg("dim", pageInfo),
				0,
				0,
			);
		},

		renderResult(result: { content?: any[]; details?: any; }, { expanded }: { expanded?: boolean }, theme: Theme) {
			const details = result.details as {
				title?: string;
				totalLength?: number;
				returnedLength?: number;
				hasMore?: boolean;
				fromCache?: boolean;
				error?: string;
			};
			if (details?.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const cacheBadge = details?.fromCache ? theme.fg("success", " ⚡") : "";
			const statusLine =
				theme.fg("success", details?.title || "Content") +
				theme.fg("dim", ` (${details?.returnedLength ?? 0}/${details?.totalLength ?? 0})`) +
				cacheBadge;

			if (!expanded) return new Text(statusLine, 0, 0);

			const textContent = result.content?.find((c: any) => c.type === "text")?.text || "";
			const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
			return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
		},
	} as any);

	pi.registerMessageRenderer("web-guidance", (message, _opts: MessageRenderOptions, theme: Theme) =>
		new Text(theme.fg("warning", String(message.content)), 0, 0)
	);
}
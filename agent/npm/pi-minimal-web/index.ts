import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { fetchAllContent } from "./extract.js";
import { search } from "./exa.js";
import { validateUrl, sanitizeContent, sanitizeSearchResult } from "./security.js";

const DEFAULT_MAX_LENGTH = 1000;
const ABSOLUTE_MAX_LENGTH = 10000;
const CONTENT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONTENT_CACHE_SIZE = 20;

const DEFAULT_SEARCH_RESULTS = 1;
const MAX_SEARCH_RESULTS = 5;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_SIZE = 10;

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
    results: Array<{ title: string; url: string; snippet?: string }>
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

function findSmartCutPoint(text: string, maxLength: number): number {
    if (text.length <= maxLength) return text.length;
    const beforeLimit = text.slice(0, maxLength);
    const lastParagraph = beforeLimit.lastIndexOf("\n\n");
    if (lastParagraph > maxLength * 0.8) return lastParagraph;
    const lastSentence = Math.max(
        beforeLimit.lastIndexOf(". "),
        beforeLimit.lastIndexOf(".\n"),
        beforeLimit.lastIndexOf("! "),
        beforeLimit.lastIndexOf("? ")
    );
    if (lastSentence > maxLength * 0.7) return lastSentence + 1;
    const lastLine = beforeLimit.lastIndexOf("\n");
    if (lastLine > maxLength * 0.6) return lastLine;
    return maxLength;
}

export default function (pi: ExtensionAPI) {
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

        async execute(_toolCallId, params, signal) {
            const query = params.query.trim();
            const numResults = Math.min(
                params.numResults ?? DEFAULT_SEARCH_RESULTS,
                MAX_SEARCH_RESULTS
            );
            const offset = Math.max(0, params.offset ?? 0);

            if (!query) {
                return {
                    content: [{ type: "text", text: "Error: Query is required" }],
                    details: { error: "No query provided" },
                };
            }

            if (Math.random() < 0.1) clearExpiredSearchCache();

            try {
                let answer: string;
                let allResults: Array<{ title: string; url: string; snippet?: string }>;
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
                    const requestNumResults = offset > 0 
                        ? Math.min(numResults + offset, MAX_SEARCH_RESULTS)
                        : numResults;

                    const searchResult = await search(query, {
                        numResults: requestNumResults,
                        signal,
                    });

                    // Очистка ответа и результатов
                    answer = searchResult.answer ? sanitizeContent(searchResult.answer) : searchResult.answer;
                    allResults = searchResult.results.map(sanitizeSearchResult);

                    if (offset === 0) {
                        setCachedSearch(query, numResults, answer, allResults);
                    }
                }

                const paginatedResults = allResults.slice(offset, offset + numResults);
                const hasMore = offset + numResults < allResults.length;

                if (paginatedResults.length === 0) {
                    return {
                        content: [{ 
                            type: "text", 
                            text: `[No more results. Total: ${allResults.length} found.]` 
                        }],
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
                output += paginatedResults.map((r, i) => {
                    const num = offset + i + 1;
                    return `${num}. ${r.title}\n   ${r.url}`;
                }).join("\n\n");

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
                    output += `\n💡 To read a page, call fetch_content with:\n`;
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
                        urls: paginatedResults.map(r => r.url),
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

        renderCall(args, theme) {
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
                0, 0
            );
        },

        renderResult(result, { expanded }, theme) {
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
            const statusLine = theme.fg("success", `${details?.resultCount ?? 0}/${details?.totalResults ?? 0}`) + cacheBadge;
            
            if (!expanded) return new Text(statusLine, 0, 0);
            
            const textContent = result.content.find((c) => c.type === "text")?.text || "";
            const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
            return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
        },
    });

    // ═════════════════════════════════════════════════════════
    // FETCH CONTENT
    // ═════════════════════════════════════════════════════════
    pi.registerTool({
        name: "fetch_content",
        label: "Fetch Content",
        promptSnippet: `Fetch URL as markdown. fetch_content({url, maxLength, offset})`,
        parameters: Type.Object({
            url: Type.String(),
            maxLength: Type.Optional(Type.Number()),
            offset: Type.Optional(Type.Number()),
        }),

        async execute(_toolCallId, params, signal) {
            const { url } = params;
            const maxLength = Math.min(
                params.maxLength ?? DEFAULT_MAX_LENGTH,
                ABSOLUTE_MAX_LENGTH
            );
            const offset = Math.max(0, params.offset ?? 0);

            if (!url) {
                return {
                    content: [{ type: "text", text: "Error: URL is required" }],
                    details: { error: "No URL provided" },
                };
            }

            // SSRF PROTECTION: Валидация URL перед загрузкой
            const urlValidation = validateUrl(url);
            if (!urlValidation.valid) {
                return {
                    content: [{ type: "text", text: `Error: ${urlValidation.error}` }],
                    details: { error: urlValidation.error, url },
                };
            }

            if (Math.random() < 0.1) clearExpiredContentCache();

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

                    // Очистка контента перед кэшированием
                    fullContent = sanitizeContent(result.content);
                    title = sanitizeContent(result.title);
                    setCachedContent(url, title, fullContent);
                }

                const totalLength = fullContent.length;

                if (offset >= totalLength) {
                    return {
                        content: [{ 
                            type: "text", 
                            text: `[End of content. Total: ${totalLength} chars.]` 
                        }],
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
                    output += `💡 To read more, call fetch_content with:\n`;
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

        renderCall(args, theme) {
            const { url, maxLength, offset } = args as { 
                url?: string; 
                maxLength?: number; 
                offset?: number; 
            };
            if (!url) {
                return new Text(
                    theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"),
                    0, 0
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
                0, 0
            );
        },

        renderResult(result, { expanded }, theme) {
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
            const statusLine = theme.fg("success", details?.title || "Content") + 
                theme.fg("muted", ` (${details?.returnedLength ?? 0}/${details?.totalLength ?? 0})`) +
                cacheBadge;
            
            if (!expanded) return new Text(statusLine, 0, 0);
            
            const textContent = result.content.find((c) => c.type === "text")?.text || "";
            const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
            return new Text(statusLine + "\n" + theme.fg("dim", preview), 0, 0);
        },
    });
}
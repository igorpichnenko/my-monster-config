/* exa.ts */

import { activityMonitor } from "./activity.js";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

export interface SearchResponse {
	answer: string;
	results: SearchResult[];
}

export interface SearchOptions {
	numResults?: number;
	recencyFilter?: "day" | "week" | "month" | "year";
	domainFilter?: string[];
	signal?: AbortSignal;
}

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

export type McpParsedResult = { title: string; url: string; content: string };

interface ExaMcpRpcResponse {
	result?: {
		content?: Array<{ type?: string; text?: string }>;
		isError?: boolean;
	};
	error?: {
		code?: number;
		message?: string;
	};
}

// ✅ Исправлено: AbortSignal больше не оставляет "висящих" таймаутов
function createRequestSignal(
	signal?: AbortSignal,
	timeoutMs: number = 60000,
): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	const onAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) {
			controller.abort();
		} else {
			signal.addEventListener("abort", onAbort);
		}
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeoutId);
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

async function callExaMcpSingle(
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
	timeoutMs: number = 60000,
): Promise<string> {
	// ✅ Ранняя проверка abort
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}

	const { signal: reqSignal, cleanup } = createRequestSignal(signal, timeoutMs);

	try {
		const response = await fetch(EXA_MCP_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: toolName,
					arguments: args,
				},
			}),
			signal: reqSignal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`);
		}

		const body = await response.text();
		const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));

		let parsed: ExaMcpRpcResponse | null = null;
		for (const line of dataLines) {
			const payload = line.slice(5).trim();
			if (!payload) continue;
			try {
				const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
				if (candidate?.result || candidate?.error) {
					parsed = candidate;
					break;
				}
			} catch {
				/* skip invalid JSON lines */
			}
		}

		// Fallback: попытка распарсить как обычный JSON
		if (!parsed) {
			try {
				const candidate = JSON.parse(body) as ExaMcpRpcResponse;
				if (candidate?.result || candidate?.error) {
					parsed = candidate;
				}
			} catch {
				/* not JSON */
			}
		}

		if (!parsed) {
			throw new Error("Exa MCP returned an empty response");
		}

		if (parsed.error) {
			const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
			const message = parsed.error.message || "Unknown error";
			throw new Error(`Exa MCP error${code}: ${message}`);
		}

		if (parsed.result?.isError) {
			const message = parsed.result.content
				?.find((item) => item.type === "text" && typeof item.text === "string")
				?.text?.trim();
			throw new Error(message || "Exa MCP returned an error");
		}

		const text = parsed.result?.content?.find(
			(item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0,
		)?.text;

		if (!text) {
			throw new Error("Exa MCP returned empty content");
		}

		return text;
	} finally {
		// ✅ Гарантированная очистка таймера и слушателя
		cleanup();
	}
}

export async function callExaMcp(
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	// ✅ Ранняя проверка abort
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}

	const perAttemptTimeouts = [8000, 12000, 16000];
	let lastError: Error | null = null;

	for (let i = 0; i < perAttemptTimeouts.length; i++) {
		const timeout = perAttemptTimeouts[i];

		// ✅ Проверяем abort перед каждой попыткой
		if (signal?.aborted) {
			throw new Error("Operation aborted");
		}

		try {
			return await callExaMcpSingle(toolName, args, signal, timeout);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			// Не спим после последней попытки
			const isLastAttempt = i === perAttemptTimeouts.length - 1;
			if (!isLastAttempt && !signal?.aborted) {
				await new Promise<void>((resolve) => {
					const sleepId = setTimeout(resolve, 1000);
					// ✅ Если signal отменится во время сна — просыпаемся немедленно
					if (signal) {
						const onAbort = () => {
							clearTimeout(sleepId);
							resolve();
						};
						signal.addEventListener("abort", onAbort, { once: true });
					}
				});
			}
		}
	}

	throw lastError || new Error("Exa MCP failed after retries");
}

// ✅ Более устойчивый парсер, не ломающийся на незначительных изменениях формата
function parseMcpResults(text: string): McpParsedResult[] | null {
	if (!text || typeof text !== "string") return null;

	// Разделяем блоки по заголовку "Title: " в начале строки
	const blocks = text.split(/(?=^Title:\s)/m).filter((block) => block.trim().length > 0);
	const parsed: McpParsedResult[] = [];

	for (const block of blocks) {
		// Заголовок — первая строка "Title: ..."
		const titleMatch = block.match(/^Title:\s*(.+)/m);
		const title = titleMatch ? titleMatch[1].trim() : "";

		// URL — следующая строка "URL: ..."
		const urlMatch = block.match(/^URL:\s*(.+)/m);
		const url = urlMatch ? urlMatch[1].trim() : "";

		if (!url) continue;

		// Контент: ищем "Text:" или "Highlights:"
		let content = "";
		const textStart = block.indexOf("\nText:");
		if (textStart >= 0) {
			// Ищем следующую метку после Text:, чтобы ограничить
			const afterText = block.slice(textStart + 6);
			const endMatch = afterText.search(/\n(?:Title|URL):\s/);
			content = (endMatch > 0 ? afterText.slice(0, endMatch) : afterText).trim();
		} else {
			const hlMatch = block.match(/\nHighlights:\s*\n/);
			if (hlMatch?.index != null) {
				const afterHl = block.slice(hlMatch.index + hlMatch[0].length);
				const endMatch = afterHl.search(/\n(?:Title|URL):\s/);
				content = (endMatch > 0 ? afterHl.slice(0, endMatch) : afterHl).trim();
			}
		}

		content = content.replace(/\n---\s*$/, "").trim();

		if (url.length > 0) {
			parsed.push({ title, url, content });
		}
	}

	return parsed.length > 0 ? parsed : null;
}

function buildAnswerFromMcpResults(results: McpParsedResult[]): string {
	if (results.length === 0) return "";
	const parts: string[] = [];
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const snippet = result.content.replace(/\s+/g, " ").trim().slice(0, 500);
		if (!snippet) continue;
		const sourceTitle = result.title || `Source ${i + 1}`;
		parts.push(`${snippet}\nSource: ${sourceTitle} (${result.url})`);
	}
	return parts.join("\n\n");
}

function buildMcpQuery(query: string, options: SearchOptions): string {
	const parts = [query];
	if (options.domainFilter?.length) {
		for (const d of options.domainFilter) {
			parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
		}
	}
	if (options.recencyFilter) {
		const now = new Date();
		switch (options.recencyFilter) {
			case "day":
				parts.push("past 24 hours");
				break;
			case "week":
				parts.push("past week");
				break;
			case "month":
				parts.push(`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`);
				break;
			case "year":
				parts.push(String(now.getFullYear()));
				break;
		}
	}
	return parts.join(" ");
}

export async function search(
	query: string,
	options: SearchOptions = {},
): Promise<SearchResponse> {
	// ✅ Ранняя проверка abort
	if (options.signal?.aborted) {
		throw new Error("Operation aborted");
	}

	const enrichedQuery = buildMcpQuery(query, options);
	const activityId = activityMonitor.logStart({ type: "api", query: enrichedQuery });

	try {
		const text = await callExaMcp(
			"web_search_exa",
			{
				query: enrichedQuery,
				numResults: options.numResults ?? 5,
				livecrawl: "fallback",
				type: "auto",
				contextMaxCharacters: 3000,
			},
			options.signal,
		);
		const parsedResults = parseMcpResults(text);
		activityMonitor.logComplete(activityId, 200);

		if (!parsedResults) {
			return { answer: "", results: [] };
		}

		return {
			answer: buildAnswerFromMcpResults(parsedResults),
			results: parsedResults.map((result, index) => ({
				title: result.title || `Source ${index + 1}`,
				url: result.url,
				snippet: result.content.slice(0, 200), // ✅ Добавляем snippet из content
			})),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.toLowerCase().includes("abort")) {
			activityMonitor.logComplete(activityId, 0);
		} else {
			activityMonitor.logError(activityId, message);
		}
		throw err;
	}
}
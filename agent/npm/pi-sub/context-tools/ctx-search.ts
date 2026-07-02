/**
 * ctx-search.ts — Инструмент ctx_search
 * 
 * Ищет по сохранённым выводам инструментов через FTS5.
 * Поддерживает специальный запрос "id:<number>" для получения полного вывода.
 */

import { MemoryDatabase } from "../memory/database.js";

export interface CtxSearchArgs {
  query: string;
  limit?: number;
}

export function executeCtxSearch(
  args: CtxSearchArgs,
  db: MemoryDatabase
): string {
  const { query, limit = 10 } = args;
  
  // Специальный запрос для получения полного вывода по ID
  if (query.startsWith("id:")) {
    const id = parseInt(query.slice(3));
    if (isNaN(id)) {
      return `❌ Invalid ID format. Use: id:<number>`;
    }
    
    const output = db.getToolOutput(id);
    if (!output) {
      return `❌ No output found with ID: ${id}`;
    }
    
    return `━━━ Full Output [ID: ${output.id}] ━━━\n` +
           `Tool: ${output.tool_name}\n` +
           `Date: ${new Date(output.timestamp).toLocaleString()}\n` +
           `Size: ${output.size} chars\n\n` +
           output.output;
  }
  
  // Обычный поиск
  try {
    const results = db.searchToolOutputs(query, limit);
    
    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }
    
    const lines: string[] = [
      `🔍 Found ${results.length} result(s) for: "${query}"\n`,
    ];
    
    for (const result of results) {
      const date = new Date(result.timestamp).toLocaleString();
      lines.push(`━━━ [ID: ${result.id}] ${result.tool_name} ━━━`);
      lines.push(`Date: ${date}`);
      lines.push(`Size: ${result.size} chars`);
      lines.push(`Args: ${result.args}`);
      lines.push(`\nSummary:\n${result.summary}`);
      lines.push(`\n💡 Use ctx_search with query "id:${result.id}" to get full output`);
      lines.push("");
    }
    
    return lines.join("\n");
  } catch (err) {
    throw new Error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
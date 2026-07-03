/**
 * ctx-search.ts — Инструмент ctx_search
 * 
 * Ищет по ВСЕМ таблицам с FTS5:
 * - tool_outputs (выводы инструментов)
 * - subagent_results (результаты субагентов)
 * - session_facts (извлечённые факты сессий)
 * - compaction_summaries (summary компакции контекста)
 * - compressed_results (сжатые результаты)
 * 
 * Поддерживает специальный запрос "id:<number>" для получения полного вывода.
 */

import { MemoryDatabase, type ToolOutput, type SubagentResult, type SessionFact, type CompactionSummary, type CompressedResult } from "../memory/database.js";

export interface CtxSearchArgs {
  query: string;
  limit?: number;
}

interface SearchResult {
  type: "tool_output" | "subagent_result" | "session_fact" | "compaction_summary" | "compressed_result";
  id: number | string;
  title: string;
  date: string;
  preview: string;
  extra?: Record<string, string>;
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
    
    // 1. Ищем в tool_outputs
    const toolOutput = db.getToolOutput(id);
    if (toolOutput) {
      return `━━━ Full Output [ID: ${toolOutput.id}] ━━━\n` +
             `Tool: ${toolOutput.tool_name}\n` +
             `Date: ${new Date(toolOutput.timestamp).toLocaleString()}\n` +
             `Size: ${toolOutput.size} chars\n\n` +
             toolOutput.output;
    }
    
    // 2. Ищем в subagent_results (id — строка)
    const subagentResult = db.getSubagentResult(String(id));
    if (subagentResult) {
      return `━━━ Full Subagent Result [ID: ${subagentResult.id}] ━━━\n` +
             `Agent: ${subagentResult.agent_type}\n` +
             `Description: ${subagentResult.description}\n` +
             `Date: ${new Date(subagentResult.timestamp).toLocaleString()}\n` +
             `Status: ${subagentResult.status}\n\n` +
             subagentResult.result;
    }
    
    // 3. Ищем в session_facts
    const fact = db.getFactById(id);
    if (fact) {
      return `━━━ Full Session Fact [ID: ${fact.id}] ━━━\n` +
             `Type: ${fact.fact_type}\n` +
             `Date: ${new Date(fact.timestamp).toLocaleString()}\n\n` +
             fact.content;
    }
    
    // 4. Ищем в compaction_summaries
    const summary = db.getCompactionSummaryById(id);
    if (summary) {
      let result = `━━━ Full Compaction Summary [ID: ${summary.id}] ━━━\n` +
                   `Reason: ${summary.reason}\n` +
                   `Tokens before: ${summary.tokens_before}\n` +
                   `Date: ${new Date(summary.timestamp).toLocaleString()}\n\n`;
      result += `## Summary\n${summary.summary}\n\n`;
      if (summary.detailed_summary) {
        result += `## Detailed Summary\n${summary.detailed_summary}\n`;
      }
      return result;
    }
    
    // 5. Ищем в compressed_results
    const compressedResult = db.getCompressedResultById(id);
    if (compressedResult) {
      return `━━━ Full Compressed Result [ID: ${compressedResult.id}] ━━━\n` +
             `Hash: ${compressedResult.original_hash}\n` +
             `Date: ${new Date(compressedResult.timestamp).toLocaleString()}\n\n` +
             compressedResult.compressed;
    }
    
    return `❌ No result found with ID: ${id}`;
  }
  
  // Объединённый поиск по всем таблицам с FTS5
  try {
    const allResults: SearchResult[] = [];
    
    // 1. Tool outputs
    const toolResults = db.searchToolOutputs(query, limit);
    for (const r of toolResults) {
      allResults.push({
        type: "tool_output",
        id: r.id,
        title: `Tool: ${r.tool_name}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.summary || r.output.slice(0, 100),
        extra: { Args: r.args, Size: `${r.size} chars` },
      });
    }
    
    // 2. Subagent results
    const subagentResults = db.searchSubagentResults(query, limit);
    for (const r of subagentResults) {
      allResults.push({
        type: "subagent_result",
        id: r.id,
        title: `Agent: ${r.agent_type} — ${r.description?.slice(0, 50)}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.result?.slice(0, 100) || r.description || "",
        extra: { Status: r.status, "Tool uses": String(r.tool_uses) },
      });
    }
    
    // 3. Session facts
    const factResults = db.searchFacts(query, limit);
    for (const r of factResults) {
      allResults.push({
        type: "session_fact",
        id: r.id,
        title: `Fact: [${r.fact_type}]`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.content.slice(0, 150),
        extra: { "Session": r.session_id },
      });
    }
    
    // 4. Compaction summaries
    const compactionResults = db.searchCompactionSummaries(query, limit);
    for (const r of compactionResults) {
      allResults.push({
        type: "compaction_summary",
        id: r.id,
        title: `Compaction: [${r.reason}] ${r.tokens_before} tokens`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.detailed_summary?.slice(0, 150) || r.summary?.slice(0, 150) || "",
        extra: { "Tokens": String(r.tokens_before) },
      });
    }
    
    // 5. Compressed results (НОВОЕ!)
    const compressedResults = db.searchCompressedResults(query, limit);
    for (const r of compressedResults) {
      allResults.push({
        type: "compressed_result",
        id: r.id,
        title: `Compressed: ${r.original_hash.slice(0, 16)}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.compressed.slice(0, 150),
        extra: { Hash: r.original_hash },
      });
    }
    
    // Сортируем по дате (новые сверху)
    allResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Ограничиваем общий лимит
    const results = allResults.slice(0, limit);
    
    if (results.length === 0) {
      return `No results found for: "${query}"\n\n` +
             `📊 Available data sources:\n` +
             `  • tool_outputs — tool command outputs\n` +
             `  • subagent_results — subagent execution results\n` +
             `  • session_facts — extracted session facts\n` +
             `  • compaction_summaries — context compaction summaries\n` +
             `  • compressed_results — compressed cached results`;
    }
    
    // Подсчёт по типам
    const counts: Record<string, number> = {};
    results.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    
    const lines: string[] = [
      `🔍 Found ${results.length} result(s) for: "${query}"`,
      `(${Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(", ")})\n`,
    ];
    
    for (const result of results) {
      const typeIcons: Record<string, string> = {
        tool_output: "🔧",
        subagent_result: "🤖",
        session_fact: "📝",
        compaction_summary: "📦",
        compressed_result: "🗜️",
      };
      const icon = typeIcons[result.type] || "📄";
      
      lines.push(`━━━ ${icon} [${result.type}] ID:${result.id} ━━━`);
      lines.push(`${result.title}`);
      lines.push(`Date: ${result.date}`);
      lines.push(`Preview: ${result.preview}`);
      
      if (result.extra) {
        const extraLines = Object.entries(result.extra).map(([k, v]) => `  ${k}: ${v}`);
        lines.push(extraLines.join("\n"));
      }
      
      lines.push(`💡 Use ctx_search with query "id:${result.id}" to get full content`);
      lines.push("");
    }
    
    return lines.join("\n");
  } catch (err) {
    throw new Error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
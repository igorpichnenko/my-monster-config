/**
 * ctx-search.ts — Инструмент ctx_search
 * 
 * Ищет по ВСЕМ таблицам с FTS5:
 * - tool_outputs (выводы инструментов) — с учётом priority
 * - subagent_results (результаты субагентов)
 * - session_facts (извлечённые факты сессий)
 * - compaction_summaries (summary компакции контекста)
 * - compressed_results (сжатые результаты)
 * - compaction_keywords (нормализованные ключевые слова компакций)
 * - failures (память о неудачах) — v9.2 fix
 * 
 * Поддерживает специальные запросы:
 * - "id:<number>" — получение полного вывода по числовому ID
 * - "id:<uuid>" — получение результата субагента по UUID (полному или укороченному)
 * 
 * Phase 12: Priority-based sorting
 * v9: Исправлена обработка строковых ID для subagent_results
 * v9.1: Добавлена поддержка укороченных UUID
 * v9.2: Добавлен поиск по failures (CRITICAL FIX)
 */

import { MemoryDatabase, type ToolOutput, type SubagentResult, type SessionFact, type CompactionSummary, type CompressedResult, type CompactionKeyword, type FailureRecord } from "../memory/database.js";
import { priorityEmoji, type Priority } from "../memory/utils/priority.js";

export interface CtxSearchArgs {
  query: string;
  limit?: number;
}

interface SearchResult {
  type: "tool_output" | "subagent_result" | "session_fact" | "compaction_summary" | "compressed_result" | "compaction_keywords_group" | "failure_record";
  id: number | string;
  title: string;
  date: string;
  preview: string;
  extra?: Record<string, string>;
  priority?: Priority;
}

/**
 * Проверяет, похожа ли строка на UUID (полный или укороченный).
 * 
 * Поддерживает форматы:
 * - Полный UUID: 28622e05-cd3b-4923-8f1a-5b7c9d4e6f8a
 * - Укороченный: 28622e05-cd3b-492 (то что показывает pi)
 * - Короткий префикс: 28622e05
 */
function looksLikeSubagentId(str: string): boolean {
  // Содержит hex + дефис → скорее всего UUID или его часть
  if (/^[0-9a-f]+-[0-9a-f]+/i.test(str)) {
    return true;
  }
  // Чистый hex от 6 символов (короткий префикс)
  if (/^[0-9a-f]{6,}$/i.test(str) && !/^\d+$/.test(str)) {
    return true;
  }
  return false;
}

/**
 * Находит subagent_result по ID (полному, укороченному или префиксу).
 */
function findSubagentResultById(db: MemoryDatabase, idStr: string): SubagentResult | null {
  // 1. Попытка точного совпадения (полный UUID)
  const exact = db.getSubagentResult(idStr);
  if (exact) return exact;
  
  // 2. Поиск по префиксу в БД напрямую
  const raw = db.getRaw();
  const rows = raw.prepare(`
    SELECT * FROM subagent_results
    WHERE id LIKE ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).all(`${idStr}%`) as SubagentResult[];
  
  return rows[0] || null;
}

export function executeCtxSearch(
  args: CtxSearchArgs,
  db: MemoryDatabase
): string {
  const { query, limit = 10 } = args;
  
  // Специальный запрос для получения полного вывода по ID
  if (query.startsWith("id:")) {
    const idStr = query.slice(3).trim();
    
    if (!idStr) {
      return `❌ Empty ID. Use: id:<number> or id:<uuid>`;
    }
    
    // v9.1: Сначала проверяем, похож ли ID на subagent ID
    if (looksLikeSubagentId(idStr)) {
      const subagentResult = findSubagentResultById(db, idStr);
      if (subagentResult) {
        return `━━━ Full Subagent Result [ID: ${subagentResult.id}] ━━━\n` +
               `Agent: ${subagentResult.agent_type}\n` +
               `Description: ${subagentResult.description}\n` +
               `Date: ${new Date(subagentResult.timestamp).toLocaleString()}\n` +
               `Status: ${subagentResult.status}\n` +
               `Tool uses: ${subagentResult.tool_uses}\n` +
               `Duration: ${subagentResult.duration_ms}ms\n\n` +
               subagentResult.result;
      }
      return `❌ No subagent result found with ID: ${idStr}\n` +
             `💡 Tip: pi uses shortened UUIDs. Try the ID from ctx_search results ` +
             `(e.g., "28622e05-cd3b-492") or just the first 8 characters.`;
    }
    
    // Числовой ID — для остальных таблиц
    const id = parseInt(idStr);
    if (isNaN(id)) {
      return `❌ Invalid ID format. Use: id:<number> or id:<uuid>`;
    }
    
    // 1. Ищем в tool_outputs
    const toolOutput = db.getToolOutput(id);
    if (toolOutput) {
      const emoji = priorityEmoji(toolOutput.priority as Priority);
      return `━━━ ${emoji} Full Output [ID: ${toolOutput.id}] ━━━\n` +
             `Tool: ${toolOutput.tool_name}\n` +
             `Priority: ${toolOutput.priority} ${emoji}\n` +
             `Date: ${new Date(toolOutput.timestamp).toLocaleString()}\n` +
             `Size: ${toolOutput.size} chars\n\n` +
             toolOutput.output;
    }
    
    // 2. Ищем в session_facts
    const fact = db.getFactById(id);
    if (fact) {
      return `━━━ Full Session Fact [ID: ${fact.id}] ━━━\n` +
             `Type: ${fact.fact_type}\n` +
             `Date: ${new Date(fact.timestamp).toLocaleString()}\n\n` +
             fact.content;
    }
    
    // 3. Ищем в compaction_summaries
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
    
    // 4. Ищем в compressed_results
    const compressedResult = db.getCompressedResultById(id);
    if (compressedResult) {
      return `━━━ Full Compressed Result [ID: ${compressedResult.id}] ━━━\n` +
             `Hash: ${compressedResult.original_hash}\n` +
             `Date: ${new Date(compressedResult.timestamp).toLocaleString()}\n\n` +
             compressedResult.compressed;
    }
    
    // 5. Ищем в failures — v9.2 fix
    const failure = db.getFailureById(id);
    if (failure) {
      let result = `━━━ ⚠️ Full Failure Record [ID: ${failure.id}] ━━━\n` +
                   `Session: ${failure.session_id}\n` +
                   `Date: ${new Date(failure.timestamp).toLocaleString()}\n\n`;
      result += `## Approach\n${failure.approach}\n\n`;
      result += `## Error\n${failure.error}\n\n`;
      if (failure.reason) {
        result += `## Reason\n${failure.reason}\n\n`;
      }
      if (failure.solution) {
        result += `## Solution\n${failure.solution}\n\n`;
      }
      if (failure.context) {
        result += `## Context\n${failure.context}\n`;
      }
      return result;
    }
    
    // 6. Ищем в compaction_keywords (по keyword ID)
    const keywords = db.getCompactionKeywords(id);
    if (keywords.length > 0) {
      const compactionId = keywords[0].compaction_id;
      const compaction = db.getCompactionSummaryById(compactionId);
      
      if (compaction) {
        let result = `━━━ Compaction Summary [ID: ${compaction.id}] ━━━\n`;
        result += `(Found via keyword ID: ${id})\n\n`;
        result += `Reason: ${compaction.reason}\n`;
        result += `Tokens before: ${compaction.tokens_before}\n`;
        result += `Date: ${new Date(compaction.timestamp).toLocaleString()}\n\n`;
        result += `## Summary\n${compaction.summary}\n\n`;
        
        if (compaction.detailed_summary) {
          result += `## Detailed Summary\n${compaction.detailed_summary}\n\n`;
        }
        
        const byCategory: Record<string, string[]> = {
          file: [],
          decision: [],
          lesson: [],
        };
        
        for (const kw of keywords) {
          byCategory[kw.category].push(kw.keyword);
        }
        
        result += `## Keywords\n`;
        if (byCategory.file.length > 0) {
          result += `📄 Files: ${byCategory.file.join(", ")}\n`;
        }
        if (byCategory.decision.length > 0) {
          result += `🎯 Decisions: ${byCategory.decision.join(", ")}\n`;
        }
        if (byCategory.lesson.length > 0) {
          result += `💡 Lessons: ${byCategory.lesson.join(", ")}\n`;
        }
        
        return result;
      }
    }
    
    return `❌ No result found with ID: ${id}`;
  }
  
  // Объединённый поиск по всем таблицам с FTS5
  try {
    const allResults: SearchResult[] = [];
    
    // 1. Tool outputs — уже отсортированы по priority DESC, timestamp DESC
    const toolResults = db.searchToolOutputs(query, limit);
    for (const r of toolResults) {
      const emoji = priorityEmoji(r.priority as Priority);
      allResults.push({
        type: "tool_output",
        id: r.id,
        title: `${emoji} Tool: ${r.tool_name}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.summary || r.output.slice(0, 100),
        extra: { 
          Args: r.args, 
          Size: `${r.size} chars`,
          Priority: `${r.priority} ${emoji}`,
        },
        priority: r.priority as Priority,
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
      const preview = r.detailed_summary?.slice(0, 500) || r.summary?.slice(0, 300) || "";
      
      allResults.push({
        type: "compaction_summary",
        id: r.id,
        title: `Compaction: [${r.reason}] ${r.tokens_before} tokens`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: preview,
        extra: { "Tokens": String(r.tokens_before) },
      });
    }
    
    // 5. Compressed results
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
    
    // 6. Compaction keywords — группируем по compaction_id
    const keywordResults = db.searchKeywords(query, limit * 3);
    
    const groupedKeywords = new Map<number, {
      keywords: typeof keywordResults;
      reason: string;
      tokens_before: number;
      timestamp: number;
    }>();
    
    for (const r of keywordResults) {
      if (!groupedKeywords.has(r.compaction_id)) {
        groupedKeywords.set(r.compaction_id, {
          keywords: [],
          reason: r.compaction_reason,
          tokens_before: r.compaction_tokens_before,
          timestamp: r.compaction_timestamp,
        });
      }
      groupedKeywords.get(r.compaction_id)!.keywords.push(r);
    }
    
    for (const [compactionId, group] of groupedKeywords) {
      const files = group.keywords
        .filter(k => k.category === "file")
        .map(k => k.keyword)
        .slice(0, 3);
      
      const decisions = group.keywords
        .filter(k => k.category === "decision")
        .map(k => k.keyword)
        .slice(0, 2);
      
      const lessons = group.keywords
        .filter(k => k.category === "lesson")
        .map(k => k.keyword)
        .slice(0, 2);
      
      let preview = "";
      if (files.length > 0) preview += `📄 ${files.join(", ")}`;
      if (decisions.length > 0) preview += ` | 🎯 ${decisions.join(", ")}`;
      if (lessons.length > 0) preview += ` | 💡 ${lessons.join(", ")}`;
      
      const totalKeywords = group.keywords.length;
      
      allResults.push({
        type: "compaction_keywords_group",
        id: compactionId,
        title: `Compaction Keywords: [${group.reason}] ${group.tokens_before} tokens`,
        date: new Date(group.timestamp).toLocaleString(),
        preview: preview || `${totalKeywords} keywords found`,
        extra: { 
          "Keywords count": String(totalKeywords),
          "Compaction ID": String(compactionId),
        },
      });
    }
    
    // 7. Failures (неудачные подходы) — v9.2 fix
    const failureResults = db.searchFailures(query, limit);
    for (const r of failureResults) {
      allResults.push({
        type: "failure_record",
        id: r.id,
        title: `⚠️ Failure: ${r.approach?.slice(0, 50) || "Unknown approach"}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.error?.slice(0, 150) || "",
        extra: {
          "Session": r.session_id,
          "Solution": r.solution?.slice(0, 80) || "N/A",
        },
      });
    }
    
    // Сортируем по дате (новые сверху)
    allResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Ограничиваем общий лимит
    const results = allResults.slice(0, limit);
    
    if (results.length === 0) {
      return `No results found for: "${query}"\n\n` +
             `📊 Available data sources:\n` +
             `  • tool_outputs — tool command outputs (sorted by priority)\n` +
             `  • subagent_results — subagent execution results\n` +
             `  • session_facts — extracted session facts\n` +
             `  • compaction_summaries — context compaction summaries\n` +
             `  • compressed_results — compressed cached results\n` +
             `  • compaction_keywords — normalized keywords from compactions\n` +
             `  • failure_records — failed approaches and their solutions`;
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
        compaction_keywords_group: "🔑",
        failure_record: "⚠️",
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
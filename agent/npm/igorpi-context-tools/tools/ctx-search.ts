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
 * - failures (память о неудачах)
 * - code_diagnostics (ошибки TypeScript/Python/C++) — v14
 * - code_dependencies (зависимости между файлами) — v14
 * - unused_code (неиспользуемый код) — v14
 * - code_duplicates (дубликаты кода) — v14
 * 
 * Поддерживает специальные запросы:
 * - "id:<number>" — получение полного вывода по числовому ID
 * - "id:<uuid>" — получение результата субагента по UUID
 * 
 * v14: Добавлен поиск по code analysis таблицам
 * v14.2: Исправлен projectPath — используем process.cwd() напрямую
 */

import { MemoryDatabase, type ToolOutput, type SubagentResult, type SessionFact, type CompactionSummary, type CompressedResult, type CompactionKeyword, type FailureRecord, type CodeDiagnostic, type CodeDependency, type UnusedCode, type CodeDuplicate, priorityEmoji, escapeFts5Query, type Priority } from "../../igorpi-memory/index.js";

export interface CtxSearchArgs {
  query: string;
  limit?: number;
}

interface SearchResult {
  type: "tool_output" | "subagent_result" | "session_fact" | "compaction_summary" | 
        "compressed_result" | "compaction_keywords_group" | "failure_record" |
        "code_diagnostic" | "code_dependency" | "unused_code" | "code_duplicate";
  id: number | string;
  title: string;
  date: string;
  preview: string;
  extra?: Record<string, string>;
  priority?: Priority;
}

/**
 * Проверяет, похожа ли строка на UUID (полный или укороченный).
 */
function looksLikeSubagentId(str: string): boolean {
  if (/^[0-9a-f]+-[0-9a-f]+/i.test(str)) {
    return true;
  }
  if (/^[0-9a-f]{6,}$/i.test(str) && !/^\d+$/.test(str)) {
    return true;
  }
  return false;
}

/**
 * Находит subagent_result по ID.
 */
function findSubagentResultById(db: MemoryDatabase, idStr: string): SubagentResult | null {
  const exact = db.getSubagentResult(idStr);
  if (exact) return exact;
  
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
  // v14.2: Используем process.cwd() напрямую для совпадения с igorpi-code-analysis
  const projectPath = process.cwd();
  
  // Специальный запрос для получения полного вывода по ID
  if (query.startsWith("id:")) {
    const idStr = query.slice(3).trim();
    
    if (!idStr) {
      return `❌ Empty ID. Use: id:<number> or id:<uuid>`;
    }
    
    // Subagent ID
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
      return `❌ No subagent result found with ID: ${idStr}`;
    }
    
    // Числовой ID
    const id = parseInt(idStr);
    if (isNaN(id)) {
      return `❌ Invalid ID format. Use: id:<number> or id:<uuid>`;
    }
    
    // 1. tool_outputs
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
    
    // 2. session_facts
    const fact = db.getFactById(id);
    if (fact) {
      return `━━━ Full Session Fact [ID: ${fact.id}] ━━━\n` +
             `Type: ${fact.fact_type}\n` +
             `Date: ${new Date(fact.timestamp).toLocaleString()}\n\n` +
             fact.content;
    }
    
    // 3. compaction_summaries
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
    
    // 4. compressed_results
    const compressedResult = db.getCompressedResultById(id);
    if (compressedResult) {
      return `━━━ Full Compressed Result [ID: ${compressedResult.id}] ━━━\n` +
             `Hash: ${compressedResult.original_hash}\n` +
             `Date: ${new Date(compressedResult.timestamp).toLocaleString()}\n\n` +
             compressedResult.compressed;
    }
    
    // 5. failures
    const failure = db.getFailureById(id);
    if (failure) {
      let result = `━━━ ⚠️ Full Failure Record [ID: ${failure.id}] ━━━\n` +
                   `Session: ${failure.session_id}\n` +
                   `Date: ${new Date(failure.timestamp).toLocaleString()}\n\n`;
      result += `## Approach\n${failure.approach}\n\n`;
      result += `## Error\n${failure.error}\n\n`;
      if (failure.reason) result += `## Reason\n${failure.reason}\n\n`;
      if (failure.solution) result += `## Solution\n${failure.solution}\n\n`;
      if (failure.context) result += `## Context\n${failure.context}\n`;
      return result;
    }
    
    // 6. compaction_keywords
    const keyword = db.getKeywordById(id);
    if (keyword) {
      const compaction = db.getCompactionSummaryById(keyword.compaction_id);
      if (compaction) {
        let result = `━━━ Compaction Summary [ID: ${compaction.id}] ━━━\n`;
        result += `(Found via keyword ID: ${id}, keyword: "${keyword.keyword}")\n\n`;
        result += `Reason: ${compaction.reason}\n`;
        result += `Tokens before: ${compaction.tokens_before}\n`;
        result += `Date: ${new Date(compaction.timestamp).toLocaleString()}\n\n`;
        result += `## Summary\n${compaction.summary}\n\n`;
        if (compaction.detailed_summary) {
          result += `## Detailed Summary\n${compaction.detailed_summary}\n\n`;
        }
        return result;
      }
    }
    
    // 7. code_diagnostics — v14
    const diagnostic = db.getDiagnosticById(id);
    if (diagnostic) {
      const icon = diagnostic.severity === "error" ? "❌" : 
                   diagnostic.severity === "warning" ? "⚠️" : "ℹ️";
      let result = `━━━ ${icon} Code Diagnostic [ID: ${diagnostic.id}] ━━━\n` +
                   `File: ${diagnostic.file_path}\n` +
                   `Location: Line ${diagnostic.line}, Column ${diagnostic.column}\n` +
                   `Severity: ${diagnostic.severity}\n` +
                   `Source: ${diagnostic.source}\n` +
                   `Date: ${new Date(diagnostic.timestamp).toLocaleString()}\n\n`;
      result += `## Message\n${diagnostic.message}\n\n`;
      if (diagnostic.rule_id) result += `Rule: ${diagnostic.rule_id}\n`;
      if (diagnostic.suggestion) result += `\n## Suggestion\n${diagnostic.suggestion}\n`;
      return result;
    }
    
    // 8. code_dependencies — v14 (по ID связи)
    try {
      const raw = db.getRaw();
      const dep = raw.prepare("SELECT * FROM code_dependencies WHERE id = ?").get(id) as CodeDependency | undefined;
      if (dep) {
        return `━━━ 🔗 Code Dependency [ID: ${dep.id}] ━━━\n` +
               `File: ${dep.file_path}\n` +
               `Depends on: ${dep.depends_on}\n` +
               `Type: ${dep.dependency_type}\n` +
               `Circular: ${dep.is_circular ? "🔄 YES" : "No"}\n` +
               `Date: ${new Date(dep.timestamp).toLocaleString()}\n`;
      }
    } catch {}
    
    // 9. unused_code — v14
    try {
      const raw = db.getRaw();
      const unused = raw.prepare("SELECT * FROM unused_code WHERE id = ?").get(id) as UnusedCode | undefined;
      if (unused) {
        return `━━━ 🗑️ Unused Code [ID: ${unused.id}] ━━━\n` +
               `File: ${unused.file_path}\n` +
               `Symbol: ${unused.symbol_name} (${unused.symbol_type})\n` +
               `Line: ${unused.line}\n` +
               `Confidence: ${Math.round(unused.confidence * 100)}%\n` +
               `Date: ${new Date(unused.timestamp).toLocaleString()}\n`;
      }
    } catch {}
    
    // 10. code_duplicates — v14
    try {
      const raw = db.getRaw();
      const dup = raw.prepare("SELECT * FROM code_duplicates WHERE id = ?").get(id) as CodeDuplicate | undefined;
      if (dup) {
        return `━━━ 📋 Code Duplicate [ID: ${dup.id}] ━━━\n` +
               `File 1: ${dup.file_path_1} (lines ${dup.line_start_1}-${dup.line_end_1})\n` +
               `File 2: ${dup.file_path_2} (lines ${dup.line_start_2}-${dup.line_end_2})\n` +
               `Lines: ${dup.lines_count}\n` +
               `Similarity: ${Math.round(dup.similarity * 100)}%\n` +
               `Date: ${new Date(dup.timestamp).toLocaleString()}\n`;
      }
    } catch {}
    
    return `❌ No result found with ID: ${id}`;
  }
  
  // Объединённый поиск по всем таблицам с FTS5
  try {
    const escapedQuery = escapeFts5Query(query);
    const allResults: SearchResult[] = [];
    
    // 1. Tool outputs
    const toolResults = db.searchToolOutputs(escapedQuery, limit);
    for (const r of toolResults) {
      const emoji = priorityEmoji(r.priority as Priority);
      allResults.push({
        type: "tool_output",
        id: r.id,
        title: `${emoji} Tool: ${r.tool_name}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.summary || r.output.slice(0, 100),
        extra: { Args: r.args, Size: `${r.size} chars`, Priority: `${r.priority} ${emoji}` },
        priority: r.priority as Priority,
      });
    }
    
    // 2. Subagent results
    const subagentResults = db.searchSubagentResults(escapedQuery, limit);
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
    const factResults = db.searchFacts(escapedQuery, limit);
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
    const compactionResults = db.searchCompactionSummaries(escapedQuery, limit);
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
    const compressedResults = db.searchCompressedResults(escapedQuery, limit);
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
    
    // 6. Compaction keywords
    const keywordResults = db.searchKeywords(escapedQuery, limit * 3);
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
      const files = group.keywords.filter(k => k.category === "file").map(k => k.keyword).slice(0, 3);
      const decisions = group.keywords.filter(k => k.category === "decision").map(k => k.keyword).slice(0, 2);
      const lessons = group.keywords.filter(k => k.category === "lesson").map(k => k.keyword).slice(0, 2);
      
      let preview = "";
      if (files.length > 0) preview += `📄 ${files.join(", ")}`;
      if (decisions.length > 0) preview += ` | 🎯 ${decisions.join(", ")}`;
      if (lessons.length > 0) preview += ` | 💡 ${lessons.join(", ")}`;
      
      allResults.push({
        type: "compaction_keywords_group",
        id: compactionId,
        title: `Compaction Keywords: [${group.reason}] ${group.tokens_before} tokens`,
        date: new Date(group.timestamp).toLocaleString(),
        preview: preview || `${group.keywords.length} keywords found`,
        extra: { "Keywords count": String(group.keywords.length), "Compaction ID": String(compactionId) },
      });
    }
    
    // 7. Failures
    const failureResults = db.searchFailures(escapedQuery, limit);
    for (const r of failureResults) {
      allResults.push({
        type: "failure_record",
        id: r.id,
        title: `⚠️ Failure: ${r.approach?.slice(0, 50) || "Unknown approach"}`,
        date: new Date(r.timestamp).toLocaleString(),
        preview: r.error?.slice(0, 150) || "",
        extra: { "Session": r.session_id, "Solution": r.solution?.slice(0, 80) || "N/A" },
      });
    }
    
    // 8. Code diagnostics — v14
    if (projectPath) {
      const diagnosticResults = db.searchDiagnostics(escapedQuery, projectPath, limit);
      for (const r of diagnosticResults) {
        const icon = r.severity === "error" ? "❌" : r.severity === "warning" ? "⚠️" : "ℹ️";
        allResults.push({
          type: "code_diagnostic",
          id: r.id,
          title: `${icon} [${r.severity}] ${r.file_path}:${r.line}:${r.column}`,
          date: new Date(r.timestamp).toLocaleString(),
          preview: r.message.slice(0, 150),
          extra: {
            "Source": r.source,
            "Rule": r.rule_id || "N/A",
            "File": r.file_path,
          },
        });
      }
    }
    
    // 9. Code dependencies — v14
    if (projectPath) {
      const depResults = db.searchDependencies(escapedQuery, projectPath, limit);
      for (const r of depResults) {
        allResults.push({
          type: "code_dependency",
          id: r.id,
          title: `🔗 ${r.file_path} → ${r.depends_on}`,
          date: new Date(r.timestamp).toLocaleString(),
          preview: `Dependency type: ${r.dependency_type}${r.is_circular ? " (🔄 CIRCULAR)" : ""}`,
          extra: {
            "Type": r.dependency_type,
            "Circular": r.is_circular ? "YES" : "No",
          },
        });
      }
    }
    
    // 10. Unused code — v14
    if (projectPath) {
      const unusedResults = db.searchUnused(escapedQuery, projectPath, limit);
      for (const r of unusedResults) {
        allResults.push({
          type: "unused_code",
          id: r.id,
          title: `🗑️ ${r.symbol_name} (${r.symbol_type}) in ${r.file_path}:${r.line}`,
          date: new Date(r.timestamp).toLocaleString(),
          preview: `Confidence: ${Math.round(r.confidence * 100)}%`,
          extra: {
            "Symbol": r.symbol_name,
            "Type": r.symbol_type,
            "Confidence": `${Math.round(r.confidence * 100)}%`,
          },
        });
      }
    }
    
    // 11. Code duplicates — v14
    if (projectPath) {
      const dupResults = db.searchDuplicates(escapedQuery, projectPath, limit);
      for (const r of dupResults) {
        allResults.push({
          type: "code_duplicate",
          id: r.id,
          title: `📋 Duplicate: ${r.file_path_1} ↔ ${r.file_path_2}`,
          date: new Date(r.timestamp).toLocaleString(),
          preview: `Similarity: ${Math.round(r.similarity * 100)}%, ${r.lines_count} lines`,
          extra: {
            "Similarity": `${Math.round(r.similarity * 100)}%`,
            "Lines": String(r.lines_count),
          },
        });
      }
    }
    
    // Сортируем по дате (новые сверху)
    allResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
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
             `  • failure_records — failed approaches and their solutions\n` +
             `  • code_diagnostics — TypeScript/Python/C++ errors (v14)\n` +
             `  • code_dependencies — file dependencies (v14)\n` +
             `  • unused_code — unused symbols (v14)\n` +
             `  • code_duplicates — code duplicates (v14)`;
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
        code_diagnostic: "🔬",
        code_dependency: "🔗",
        unused_code: "🗑️",
        code_duplicate: "📋",
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
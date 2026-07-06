/**
 * ctx-stats.ts — Инструмент ctx_stats для MCP сервера
 * 
 * Показывает статистику по сохранённым данным.
 */

import { MemoryDatabase } from "pi-memory";
import { logger } from "../utils/logger.js";

export function executeCtxStats(db: MemoryDatabase): string {
  logger.info("Getting stats");
  
  try {
    const stats = db.getStats();
    
    const lines: string[] = [
      "📊 Memory Database Statistics",
      "",
      `Tool outputs: ${stats.toolOutputs}`,
      `Subagent results: ${stats.subagentResults}`,
      `Session facts: ${stats.sessionFacts}`,
      `Compressed results: ${stats.compressedResults}`,
      "",
      `Database size: ${stats.dbSizeMb.toFixed(2)} MB`,
    ];
    
    // Добавляем информацию о последних записях
    if (stats.toolOutputs > 0) {
      lines.push("");
      lines.push("📝 Recent tool outputs:");
      
      // ИСПРАВЛЕНО: используем getRecentToolOutputs вместо searchToolOutputs("")
      const recentOutputs = db.getRecentToolOutputs(5);
      for (const output of recentOutputs) {
        const date = new Date(output.timestamp).toLocaleString();
        const summary = output.summary.split("\n")[0];
        lines.push(`  [ID:${output.id}] ${output.tool_name} (${output.size} chars) - ${date}`);
        lines.push(`    ${summary}`);
      }
    }
    
    return lines.join("\n");
  } catch (err) {
    logger.error(`Failed to get stats: ${err}`);
    throw new Error(`Failed to get stats: ${err instanceof Error ? err.message : String(err)}`);
  }
}
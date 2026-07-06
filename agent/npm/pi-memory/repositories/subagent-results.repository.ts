/**
 * subagent-results.repository.ts — Репозиторий для subagent_results.
 * 
 * v9: Исправлен search() — экранирование специальных символов FTS5
 * v9.3: save() возвращает number, использует ON CONFLICT DO UPDATE для сохранения timestamp
 * v12: Унифицирован escapeFts5Query с ctx-search.ts (экранирует все спецсимволы FTS5)
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../context-tools/secret-scanner.js";
import { escapeFts5Query } from "../utils/fts-escape.js";

export interface SubagentResult {
  id: string;
  agent_type: string;
  description: string;
  result: string;
  timestamp: number;
  status: string;
  tool_uses: number;
  duration_ms: number;
}

/**
 * Экранирует запрос для FTS5 MATCH.
 * 
 * v12: Унифицирован с ctx-search.ts — теперь экранирует ВСЕ спецсимволы FTS5,
 *      а не только двойные кавычки.
 * 
 * Спецсимволы FTS5: + - * ~ ( ) | & { } ^ "
 * Решение: заменяем их на пробелы и оборачиваем в кавычки для поиска фразы целиком.
 */
/* function escapeFts5Query(query: string): string {
  // Экранируем все спецсимволы FTS5
  const cleaned = query
    .replace(/"/g, '')                    // убираем кавычки
    .replace(/[+\-*~()|&{}^]/g, ' ')     // заменяем спецсимволы на пробелы
    .replace(/\s+/g, ' ')                 // убираем множественные пробелы
    .trim();
  
  // Если после очистки ничего не осталось — возвращаем пустой запрос
  if (!cleaned) {
    return '""';
  }
  
  // Оборачиваем в кавычки для поиска фразы целиком
  return `"${cleaned}"`;
} */

export class SubagentResultsRepository {
  constructor(private db: Database.Database) {}

  /**
   * Сохранить результат субагента.
   * 
   * v9.3: Возвращает количество затронутых строк (0 = не изменилось, 1 = вставлено/обновлено).
   * Использует ON CONFLICT DO UPDATE вместо INSERT OR REPLACE, чтобы:
   * - Сохранить оригинальный timestamp (не обновлять при перезаписи)
   * - Сохранить rowid (важно для FTS5 триггеров)
   * - Бросить ошибку при сбое (вместо silent failure)
   */
  save(data: {
    id: string;
    agentType: string;
    description: string;
    result: string;
    status: string;
    toolUses: number;
    durationMs: number;
  }): number {
    const scanResult = scanForSecrets(data.result);
    let resultToSave = data.result;
    
    if (scanResult.hasSecret) {
      const secretTypes = scanResult.secrets.map(s => s.pattern).join(', ');
      console.warn(
        `[pi-memory] 🛡️ Secret detected in subagent result (${data.id}): ${secretTypes}. ` +
        `Saving redacted version.`
      );
      resultToSave = redactSecret(data.result);
    }
    
    try {
      const result = this.db.prepare(`
        INSERT INTO subagent_results 
        (id, agent_type, description, result, timestamp, status, tool_uses, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_type = excluded.agent_type,
          description = excluded.description,
          result = excluded.result,
          status = excluded.status,
          tool_uses = excluded.tool_uses,
          duration_ms = excluded.duration_ms
      `).run(
        data.id,
        data.agentType,
        data.description,
        resultToSave,
        Date.now(),
        data.status,
        data.toolUses,
        data.durationMs
      );
      
      return result.changes;
    } catch (err) {
      console.error(
        `[pi-memory] ❌ Failed to save subagent result ${data.id}:`,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }
  }

  getById(id: string): SubagentResult | undefined {
    return this.db.prepare(
      "SELECT * FROM subagent_results WHERE id = ?"
    ).get(id) as SubagentResult | undefined;
  }

  search(query: string, limit: number = 10): SubagentResult[] {
    // v12: Унифицированное экранирование — то же, что в ctx-search.ts
    const escapedQuery = escapeFts5Query(query);
    
    return this.db.prepare(`
      SELECT s.* FROM subagent_results s
      JOIN subagent_results_fts f ON s.rowid = f.rowid
      WHERE subagent_results_fts MATCH ?
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(escapedQuery, limit) as SubagentResult[];
  }
}
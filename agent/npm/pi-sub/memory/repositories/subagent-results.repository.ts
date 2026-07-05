/**
 * subagent-results.repository.ts — Репозиторий для subagent_results.
 * 
 * v9: Исправлен search() — экранирование специальных символов FTS5
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../../context-tools/utils/secret-scanner.js";

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
 * Проблемы, которые решает:
 * 1. Дефис в словах (general-purpose) — FTS5 интерпретирует как NOT
 * 2. Кавычки — ломают синтаксис MATCH
 * 3. Специальные символы (*, +, -, NOT, AND, OR)
 * 
 * Решение: оборачиваем запрос в двойные кавычки, что заставляет FTS5
 * искать фразу целиком, а не разбирать её на операторы.
 */
function escapeFts5Query(query: string): string {
  // Убираем двойные кавычки из запроса
  const cleaned = query.replace(/"/g, '');
  
  // Оборачиваем в кавычки для поиска фразы целиком
  return `"${cleaned}"`;
}

export class SubagentResultsRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    id: string;
    agentType: string;
    description: string;
    result: string;
    status: string;
    toolUses: number;
    durationMs: number;
  }): void {
    const scanResult = scanForSecrets(data.result);
    let resultToSave = data.result;
    
    if (scanResult.hasSecret) {
      const secretTypes = scanResult.secrets.map(s => s.pattern).join(', ');
      console.warn(
        `[pi-sub] 🛡️ Secret detected in subagent result (${data.id}): ${secretTypes}. ` +
        `Saving redacted version.`
      );
      resultToSave = redactSecret(data.result);
    }
    
    this.db.prepare(`
      INSERT OR REPLACE INTO subagent_results 
      (id, agent_type, description, result, timestamp, status, tool_uses, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  }

  getById(id: string): SubagentResult | undefined {
    return this.db.prepare(
      "SELECT * FROM subagent_results WHERE id = ?"
    ).get(id) as SubagentResult | undefined;
  }

  search(query: string, limit: number = 10): SubagentResult[] {
    // v9: Экранируем запрос для корректной работы FTS5 MATCH
    // Это решает проблему с дефисами (general-purpose) и спецсимволами
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
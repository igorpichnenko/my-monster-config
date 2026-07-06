/**
 * tool-outputs.repository.ts — Репозиторий для tool_outputs.
 * 
 * Отвечает за:
 * - Сохранение выводов инструментов
 * - Deduplication через content_hash
 * - Priority-based сортировка при поиске
 * - Secret scanning перед сохранением
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../context-tools/secret-scanner.js";
import { calculateContentHash, shortHash } from "../utils/hash.js";
import { calculatePriority, type Priority } from "../utils/priority.js";

export interface ToolOutput {
  id: number;
  tool_name: string;
  args: string;
  output: string;
  summary: string;
  timestamp: number;
  size: number;
  content_hash?: string;
  priority: Priority;
}

export interface SaveToolOutputResult {
  id: number;
  summary: string;
  isNew: boolean;
  priority: Priority;
}

export class ToolOutputsRepository {
  constructor(private db: Database.Database) {}

  /**
   * Сохраняет вывод инструмента с deduplication и priority.
   * 
   * @returns результат с ID, summary и флагом isNew
   *          Если isNew=false — это дубликат, используется кэшированный summary
   */
  save(data: {
    toolName: string;
    args: string;
    output: string;
    summary: string;
  }): SaveToolOutputResult {
    // 1. Secret Scanning
    const scanResult = scanForSecrets(data.output);
    let outputToSave = data.output;
    
    if (scanResult.hasSecret) {
      const secretTypes = scanResult.secrets.map(s => s.pattern).join(', ');
      console.warn(
        `[pi-memory] 🛡️ Secret detected in tool output (${data.toolName}): ${secretTypes}. ` +
        `Saving redacted version.`
      );
      outputToSave = redactSecret(data.output);
    }
    
    // 2. Вычисляем хэш для deduplication
    const hash = calculateContentHash(outputToSave);
    
    // 3. Проверяем дубликат
    const existing = this.db.prepare(
      "SELECT id, summary, priority FROM tool_outputs WHERE content_hash = ?"
    ).get(hash) as { id: number; summary: string; priority: number } | undefined;
    
    if (existing) {
      console.log(
        `[pi-memory] 🔄 Duplicate tool output detected (hash: ${shortHash(outputToSave)}). ` +
        `Reusing ID: ${existing.id}, priority: ${existing.priority}`
      );
      return {
        id: existing.id,
        summary: existing.summary,
        isNew: false,
        priority: existing.priority as Priority,
      };
    }
    
    // 4. Вычисляем приоритет
    const priority = calculatePriority(data.toolName, outputToSave, data.args);
    
    // 5. Сохраняем новую запись
    const stmt = this.db.prepare(`
      INSERT INTO tool_outputs 
        (tool_name, args, output, summary, timestamp, size, content_hash, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.toolName,
      data.args,
      outputToSave,
      data.summary,
      Date.now(),
      outputToSave.length,
      hash,
      priority
    );

    const id = Number(result.lastInsertRowid);
    
    console.log(
      `[pi-memory] 💾 Saved tool output (ID: ${id}, hash: ${shortHash(outputToSave)}, ` +
      `priority: ${priority}, size: ${outputToSave.length} chars)`
    );
    
    return {
      id,
      summary: data.summary,
      isNew: true,
      priority,
    };
  }

  /**
   * Получает tool_output по ID.
   */
  getById(id: number): ToolOutput | undefined {
    return this.db.prepare(
      "SELECT * FROM tool_outputs WHERE id = ?"
    ).get(id) as ToolOutput | undefined;
  }

  /**
   * Поиск по tool_outputs через FTS5.
   * Сортировка: priority DESC, timestamp DESC.
   */
  search(query: string, limit: number = 10): ToolOutput[] {
    return this.db.prepare(`
      SELECT t.* FROM tool_outputs t
      JOIN tool_outputs_fts f ON t.id = f.rowid
      WHERE tool_outputs_fts MATCH ?
      ORDER BY t.priority DESC, t.timestamp DESC
      LIMIT ?
    `).all(query, limit) as ToolOutput[];
  }

  /**
   * Получает последние N записей.
   */
  getRecent(limit: number = 10): ToolOutput[] {
    return this.db.prepare(`
      SELECT * FROM tool_outputs
      ORDER BY priority DESC, timestamp DESC
      LIMIT ?
    `).all(limit) as ToolOutput[];
  }

  /**
   * Удаляет старые записи.
   */
  purgeOld(daysOld: number = 7): number {
    try {
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(
        "DELETE FROM tool_outputs WHERE timestamp < ?"
      ).run(cutoff);
      return result.changes;
    } catch {
      return 0; // таблица не существует
    }
  }

  /**
   * Получает статистику по приоритетам.
   */
  getPriorityStats(): Record<Priority, number> {
    const rows = this.db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM tool_outputs
      GROUP BY priority
    `).all() as Array<{ priority: number; count: number }>;
    
    const stats = {} as Record<Priority, number>;
    for (let i = 1; i <= 10; i++) {
      stats[i as Priority] = 0;
    }
    for (const row of rows) {
      stats[row.priority as Priority] = row.count;
    }
    return stats;
  }
}
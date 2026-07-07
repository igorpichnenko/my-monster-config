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
  file_path?: string;
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
   * Deduplication strategy:
   *   1. content_hash — если идентичный вывод уже есть, reuse (для bash/grep и т.д.)
   *   2. file_path — если тот же файл уже есть, update (для read — актуальная версия)
   * 
   * @returns результат с ID, summary и флагом isNew
   *          Если isNew=false — это дубликат, используется кэшированный summary
   */
  save(data: {
    toolName: string;
    args: string;
    output: string;
    summary: string;
    filePath?: string;
  }): SaveToolOutputResult {
    // 1. Secret Scanning
    const scanResult = scanForSecrets(data.output);
    let outputToSave = data.output;
    
    if (scanResult.hasSecret) {
      const secretTypes = scanResult.secrets.map(s => s.pattern).join(', ');
      console.warn(
        `[igorpi-memory] 🛡️ Secret detected in tool output (${data.toolName}): ${secretTypes}. ` +
        `Saving redacted version.`
      );
      outputToSave = redactSecret(data.output);
    }
    
    // 2. Вычисляем хэш для deduplication
    const hash = calculateContentHash(outputToSave);
    
    // 3. Проверяем дубликат по content_hash
    const existing = this.db.prepare(
      "SELECT id, summary, priority FROM tool_outputs WHERE content_hash = ?"
    ).get(hash) as { id: number; summary: string; priority: number } | undefined;
    
    if (existing) {
      console.log(
        `[igorpi-memory] 🔄 Dedup by HASH (${data.toolName}): content identical, ` +
        `reusing ID: ${existing.id}, priority: ${existing.priority}`
      );
      return {
        id: existing.id,
        summary: existing.summary,
        isNew: false,
        priority: existing.priority as Priority,
      };
    }
    
    // 3b. Вычисляем приоритет (нужен и для UPDATE в path-based dedup)
    const priority = calculatePriority(data.toolName, outputToSave, data.args);
    
    // 4. Path-based deduplication (только для файлов)
    // Если тот же файл уже есть в БД — обновляем вместо insert
    // Это предотвращает рост БД при многократном чтении одного файла
    if (data.filePath) {
      const existingByPath = this.db.prepare(
        "SELECT id, summary, priority FROM tool_outputs WHERE file_path = ?"
      ).get(data.filePath) as { id: number; summary: string; priority: number } | undefined;
      
      if (existingByPath) {
        console.log(
          `[igorpi-memory] 🔄 Dedup by PATH (${data.toolName}): file='${data.filePath}', ` +
          `updating ID: ${existingByPath.id} (was priority ${existingByPath.priority}, now ${priority})` +
          ` [${outputToSave.length} chars]`
        );
        
        // Обновляем существующую запись
        this.db.prepare(
          `UPDATE tool_outputs SET output = ?, summary = ?, args = ?, timestamp = ?, size = ?, content_hash = ?, priority = ? WHERE id = ?`
        ).run(
          outputToSave,
          data.summary,
          data.args,
          Date.now(),
          outputToSave.length,
          hash,
          priority,
          existingByPath.id
        );
        
        return {
          id: existingByPath.id,
          summary: data.summary,
          isNew: false,
          priority: existingByPath.priority as Priority,
        };
      }
    }
    
    // 5. Сохраняем новую запись
    const stmt = this.db.prepare(`
      INSERT INTO tool_outputs 
        (tool_name, args, output, summary, timestamp, size, content_hash, priority, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.toolName,
      data.args,
      outputToSave,
      data.summary,
      Date.now(),
      outputToSave.length,
      hash,
      priority,
      data.filePath || null
    );

    const id = Number(result.lastInsertRowid);
    
    console.log(
      `[igorpi-memory] 💾 Saved tool output (ID: ${id}, hash: ${shortHash(outputToSave)}, ` +
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

  /**
   * Удаляет дубликаты для одного и того же file_path.
   * Оставляет только запись с последним timestamp.
   * Используется для очистки старых данных.
   */
  deduplicateByFilePath(): number {
    try {
      // Находим file_path с несколькими записями
      const duplicates = this.db.prepare(`
        SELECT file_path, GROUP_CONCAT(id) as ids, GROUP_CONCAT(timestamp) as timestamps
        FROM tool_outputs
        WHERE file_path IS NOT NULL
        GROUP BY file_path
        HAVING COUNT(*) > 1
      `).all() as Array<{ file_path: string; ids: string; timestamps: string }>;
      
      let totalDeleted = 0;
      const cleanedFiles: string[] = [];
      
      for (const dup of duplicates) {
        const ids = dup.ids.split(',').map(Number);
        const timestamps = dup.timestamps.split(',').map(Number);
        
        // Находим ID с последним timestamp (оставляем его)
        let maxTs = timestamps[0];
        let keepId = ids[0];
        for (let i = 1; i < timestamps.length; i++) {
          if (timestamps[i] > maxTs) {
            maxTs = timestamps[i];
            keepId = ids[i];
          }
        }
        
        // Удаляем все кроме keepId
        const idsToDelete = ids.filter(id => id !== keepId);
        if (idsToDelete.length > 0) {
          const placeholders = idsToDelete.map(() => '?').join(',');
          const result = this.db.prepare(
            `DELETE FROM tool_outputs WHERE id IN (${placeholders})`
          ).run(...idsToDelete);
          totalDeleted += result.changes;
          cleanedFiles.push(dup.file_path);
        }
      }
      
      if (totalDeleted > 0) {
        console.log(
          `[igorpi-memory] 🧹 Deduplicated tool_outputs: removed ${totalDeleted} duplicate records ` +
          `from ${cleanedFiles.length} file(s): ${cleanedFiles.join(', ')}`
        );
      } else {
        console.log(
          `[igorpi-memory] 🧹 No duplicate tool_outputs found by file_path`
        );
      }
      
      return totalDeleted;
    } catch {
      return 0;
    }
  }
}
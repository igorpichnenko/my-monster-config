/**
 * compaction.repository.ts — Репозиторий для compaction_summaries и compaction_keywords.
 * 
 * v11: Добавлен метод getKeywordById для корректного поиска по ID keyword
 * v13: Добавлен атомарный метод saveSummaryWithKeywords для гарантии
 *      целостности данных при пакетных операциях
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../context-tools/secret-scanner.js";

export interface CompactionSummary {
  id: number;
  session_id: string;
  reason: "manual" | "threshold" | "overflow";
  tokens_before: number;
  summary: string;
  detailed_summary: string;
  timestamp: number;
}

export interface CompactionKeyword {
  id: number;
  compaction_id: number;
  keyword: string;
  category: "file" | "decision" | "lesson";
  timestamp: number;
}

export class CompactionRepository {
  constructor(private db: Database.Database) {}

  // =========================================================================
  // Summaries
  // =========================================================================

  saveSummary(data: {
    sessionId: string;
    reason: "manual" | "threshold" | "overflow";
    tokensBefore: number;
    summary: string;
    detailedSummary?: string;
  }): number {
    let detailedToSave = data.detailedSummary || "";
    
    if (detailedToSave) {
      const scanResult = scanForSecrets(detailedToSave);
      if (scanResult.hasSecret) {
        detailedToSave = redactSecret(detailedToSave);
      }
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO compaction_summaries 
      (session_id, reason, tokens_before, summary, detailed_summary, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.sessionId,
      data.reason,
      data.tokensBefore,
      data.summary,
      detailedToSave,
      Date.now()
    );

    return Number(result.lastInsertRowid);
  }

  getSummaryById(id: number): CompactionSummary | undefined {
    return this.db.prepare(
      "SELECT * FROM compaction_summaries WHERE id = ?"
    ).get(id) as CompactionSummary | undefined;
  }

  getSummaries(sessionId: string, limit: number = 10): CompactionSummary[] {
    if (!sessionId) {
      return this.db.prepare(`
        SELECT * FROM compaction_summaries
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as CompactionSummary[];
    }
    
    return this.db.prepare(`
      SELECT * FROM compaction_summaries
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(sessionId, limit) as CompactionSummary[];
  }

  searchSummaries(query: string, limit: number = 10): CompactionSummary[] {
    return this.db.prepare(`
      SELECT c.* FROM compaction_summaries c
      JOIN compaction_summaries_fts f ON c.id = f.rowid
      WHERE compaction_summaries_fts MATCH ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `).all(query, limit) as CompactionSummary[];
  }

  purgeOldSummaries(daysOld: number = 30): number {
    try {
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(
        "DELETE FROM compaction_summaries WHERE timestamp < ?"
      ).run(cutoff);
      return result.changes;
    } catch {
      return 0;
    }
  }

  // =========================================================================
  // Keywords
  // =========================================================================

  saveKeyword(data: {
    compactionId: number;
    keyword: string;
    category: "file" | "decision" | "lesson";
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO compaction_keywords (compaction_id, keyword, category, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.compactionId,
      data.keyword,
      data.category,
      Date.now()
    );

    return Number(result.lastInsertRowid);
  }

  saveKeywords(keywords: Array<{
    compactionId: number;
    keyword: string;
    category: "file" | "decision" | "lesson";
  }>): number {
    const stmt = this.db.prepare(`
      INSERT INTO compaction_keywords (compaction_id, keyword, category, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof keywords) => {
      for (const item of items) {
        stmt.run(item.compactionId, item.keyword, item.category, Date.now());
      }
      return items.length;
    });

    return insertMany(keywords);
  }

  /**
   * v13: Атомарное сохранение summary + keywords в одной транзакции.
   * 
   * Гарантирует целостность данных:
   * - Если saveSummary упал — keywords не сохраняются
   * - Если saveKeywords упал — summary откатывается
   * - Нет состояния "summary без keywords" или "keywords без summary"
   * 
   * @returns Объект с ID компакции и количеством сохранённых keywords
   */
  saveSummaryWithKeywords(data: {
    summary: {
      sessionId: string;
      reason: "manual" | "threshold" | "overflow";
      tokensBefore: number;
      summary: string;
      detailedSummary?: string;
    };
    keywords: Array<{
      keyword: string;
      category: "file" | "decision" | "lesson";
    }>;
  }): { compactionId: number; keywordsCount: number } {
    const transaction = this.db.transaction(() => {
      // 1. Сохраняем summary
      const compactionId = this.saveSummary(data.summary);
      
      // 2. Сохраняем keywords с привязкой к compactionId
      const keywordsWithId = data.keywords.map(k => ({
        compactionId,
        keyword: k.keyword,
        category: k.category,
      }));
      
      const keywordsCount = keywordsWithId.length > 0
        ? this.saveKeywords(keywordsWithId)
        : 0;
      
      return { compactionId, keywordsCount };
    });
    
    return transaction();
  }

  /**
   * Получить keyword по его ID (первичный ключ).
   * 
   * v11: Добавлен для корректного поиска в ctx-search.ts
   */
  getKeywordById(id: number): CompactionKeyword | undefined {
    return this.db.prepare(
      "SELECT * FROM compaction_keywords WHERE id = ?"
    ).get(id) as CompactionKeyword | undefined;
  }

  /**
   * Получить все keywords для конкретной компакции.
   * 
   * Примечание: Параметр — это compaction_id, а не keyword id!
   */
  getKeywords(compactionId: number): CompactionKeyword[] {
    return this.db.prepare(`
      SELECT * FROM compaction_keywords
      WHERE compaction_id = ?
      ORDER BY category, keyword
    `).all(compactionId) as CompactionKeyword[];
  }

  searchKeywords(query: string, limit: number = 10): Array<CompactionKeyword & {
    compaction_reason: string;
    compaction_tokens_before: number;
    compaction_timestamp: number;
  }> {
    return this.db.prepare(`
      SELECT 
        ck.*,
        cs.reason as compaction_reason,
        cs.tokens_before as compaction_tokens_before,
        cs.timestamp as compaction_timestamp
      FROM compaction_keywords ck
      JOIN compaction_keywords_fts f ON ck.id = f.rowid
      JOIN compaction_summaries cs ON ck.compaction_id = cs.id
      WHERE compaction_keywords_fts MATCH ?
      ORDER BY ck.timestamp DESC
      LIMIT ?
    `).all(query, limit) as any[];
  }

  searchKeywordsByCategory(
    query: string,
    category: "file" | "decision" | "lesson",
    limit: number = 10
  ): CompactionKeyword[] {
    return this.db.prepare(`
      SELECT ck.*
      FROM compaction_keywords ck
      JOIN compaction_keywords_fts f ON ck.id = f.rowid
      WHERE compaction_keywords_fts MATCH ?
        AND ck.category = ?
      ORDER BY ck.timestamp DESC
      LIMIT ?
    `).all(query, category, limit) as CompactionKeyword[];
  }

  getRecentKeywords(limit: number = 20): CompactionKeyword[] {
    return this.db.prepare(`
      SELECT * FROM compaction_keywords
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as CompactionKeyword[];
  }

  purgeOldKeywords(daysOld: number = 30): number {
    try {
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(
        "DELETE FROM compaction_keywords WHERE timestamp < ?"
      ).run(cutoff);
      return result.changes;
    } catch {
      return 0;
    }
  }

  getKeywordsStats(): {
    total: number;
    byCategory: { file: number; decision: number; lesson: number };
    uniqueKeywords: number;
  } {
    const total = (this.db.prepare(
      "SELECT COUNT(*) as count FROM compaction_keywords"
    ).get() as { count: number }).count;

    const byCategory = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM compaction_keywords
      GROUP BY category
    `).all() as Array<{ category: string; count: number }>;

    const uniqueKeywords = (this.db.prepare(
      "SELECT COUNT(DISTINCT keyword) as count FROM compaction_keywords"
    ).get() as { count: number }).count;

    return {
      total,
      byCategory: {
        file: byCategory.find(c => c.category === "file")?.count || 0,
        decision: byCategory.find(c => c.category === "decision")?.count || 0,
        lesson: byCategory.find(c => c.category === "lesson")?.count || 0,
      },
      uniqueKeywords,
    };
  }
}
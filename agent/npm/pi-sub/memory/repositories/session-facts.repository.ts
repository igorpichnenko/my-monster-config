/**
 * session-facts.repository.ts — Репозиторий для session_facts.
 * 
 * v11: Добавлена поддержка project_path для изоляции между проектами
 * v12: searchLike теперь использует FTS5 вместо LIKE (быстрее для больших таблиц)
 */

import type Database from "better-sqlite3";

export interface SessionFact {
  id: number;
  session_id: string;
  fact_type: "decision" | "lesson" | "preference" | "architecture" | "api";
  content: string;
  timestamp: number;
  project_path?: string | null;
}

export class SessionFactsRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    sessionId: string;
    factType: "decision" | "lesson" | "preference" | "architecture" | "api";
    content: string;
    projectPath?: string | null;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO session_facts (session_id, fact_type, content, timestamp, project_path)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.sessionId,
      data.factType,
      data.content,
      Date.now(),
      data.projectPath || null
    );

    return Number(result.lastInsertRowid);
  }

  getById(id: number): SessionFact | undefined {
    return this.db.prepare(
      "SELECT * FROM session_facts WHERE id = ?"
    ).get(id) as SessionFact | undefined;
  }

  /**
   * Поиск по FTS5 с опциональным фильтром по project_path.
   * 
   * v11: Если projectPath указан — ищет только в этом проекте + факты без project_path (NULL).
   *      Если не указан — ищет по всем фактам (обратная совместимость).
   */
  search(query: string, limit: number = 10, projectPath?: string | null): SessionFact[] {
    if (projectPath) {
      // Ищем в текущем проекте + факты без project_path (старые факты)
      return this.db.prepare(`
        SELECT f.* FROM session_facts f
        JOIN session_facts_fts ft ON f.id = ft.rowid
        WHERE session_facts_fts MATCH ?
          AND (f.project_path = ? OR f.project_path IS NULL)
        ORDER BY f.timestamp DESC
        LIMIT ?
      `).all(query, projectPath, limit) as SessionFact[];
    }
    
    // Без фильтра — ищем по всем фактам
    return this.db.prepare(`
      SELECT f.* FROM session_facts f
      JOIN session_facts_fts ft ON f.id = ft.rowid
      WHERE session_facts_fts MATCH ?
      ORDER BY f.timestamp DESC
      LIMIT ?
    `).all(query, limit) as SessionFact[];
  }

  /**
   * Поиск похожих фактов по паттерну.
   * 
   * v12: Использует FTS5 вместо LIKE для лучшей производительности.
   *      LIKE с %keyword% не использует индекс и медленный для больших таблиц.
   *      FTS5 использует инвертированный индекс и быстрый.
   */
  searchLike(pattern: string, limit: number = 10, projectPath?: string | null): SessionFact[] {
    // Извлекаем ключевые слова из паттерна
    const keywords = pattern
      .replace(/%/g, '')           // убираем %
      .replace(/\s+/g, ' ')        // нормализуем пробелы
      .trim()
      .split(' ')
      .filter(w => w.length >= 3); // только слова от 3 символов
    
    if (keywords.length === 0) {
      return [];
    }
    
    // Используем FTS5 для каждого ключевого слова
    const allResults = new Map<number, SessionFact>();
    
    for (const keyword of keywords) {
      if (allResults.size >= limit) break;
      
      try {
        const results = this.search(keyword, limit, projectPath);
        for (const fact of results) {
          if (allResults.size >= limit) break;
          allResults.set(fact.id, fact);
        }
      } catch (err) {
        // Игнорируем ошибки FTS5 (например, для спецсимволов)
      }
    }
    
    return Array.from(allResults.values()).slice(0, limit);
  }

  getRecent(limit: number = 20, projectPath?: string | null): SessionFact[] {
    if (projectPath) {
      return this.db.prepare(`
        SELECT * FROM session_facts
        WHERE project_path = ? OR project_path IS NULL
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(projectPath, limit) as SessionFact[];
    }
    
    return this.db.prepare(`
      SELECT * FROM session_facts
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as SessionFact[];
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM session_facts WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  updateContent(id: number, content: string): void {
    this.db.prepare(`
      UPDATE session_facts
      SET content = ?
      WHERE id = ?
    `).run(content, id);
  }

  delete(id: number): void {
    this.db.prepare(`
      DELETE FROM session_facts
      WHERE id = ?
    `).run(id);
  }

  /**
   * Получить все факты для конкретного проекта (для консолидации).
   */
getByProject(projectPath: string, limit: number = 10000): SessionFact[] {
  return this.db.prepare(`
    SELECT * FROM session_facts
    WHERE project_path = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(projectPath, limit) as SessionFact[];
  }

  /**
   * Получить все уникальные project_path (для отладки).
   */
  getUniqueProjects(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT project_path FROM session_facts
      WHERE project_path IS NOT NULL
      ORDER BY project_path
    `).all() as Array<{ project_path: string }>;
    return rows.map(r => r.project_path);
  }
}
/**
 * session-facts.repository.ts — Репозиторий для session_facts.
 */

import type Database from "better-sqlite3";

export interface SessionFact {
  id: number;
  session_id: string;
  fact_type: "decision" | "lesson" | "preference" | "architecture" | "api";
  content: string;
  timestamp: number;
}

export class SessionFactsRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    sessionId: string;
    factType: "decision" | "lesson" | "preference" | "architecture" | "api";
    content: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO session_facts (session_id, fact_type, content, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.sessionId,
      data.factType,
      data.content,
      Date.now()
    );

    return Number(result.lastInsertRowid);
  }

  getById(id: number): SessionFact | undefined {
    return this.db.prepare(
      "SELECT * FROM session_facts WHERE id = ?"
    ).get(id) as SessionFact | undefined;
  }

  search(query: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT f.* FROM session_facts f
      JOIN session_facts_fts ft ON f.id = ft.rowid
      WHERE session_facts_fts MATCH ?
      ORDER BY f.timestamp DESC
      LIMIT ?
    `).all(query, limit) as SessionFact[];
  }

  searchLike(pattern: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT * FROM session_facts
      WHERE content LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(pattern, limit) as SessionFact[];
  }

  getRecent(limit: number = 20): SessionFact[] {
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
}
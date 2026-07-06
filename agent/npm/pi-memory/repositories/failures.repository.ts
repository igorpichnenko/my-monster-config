/**
 * failures.repository.ts — Репозиторий для failures.
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../context-tools/secret-scanner.js";

export interface FailureRecord {
  id: number;
  session_id: string;
  approach: string;
  error: string;
  reason?: string;
  solution?: string;
  context?: string;
  timestamp: number;
}

export class FailuresRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    sessionId: string;
    approach: string;
    error: string;
    reason?: string;
    solution?: string;
    context?: string;
  }): number {
    const fieldsToCheck = [
      data.approach, 
      data.error, 
      data.reason || "", 
      data.solution || "", 
      data.context || ""
    ];
    
    let hasSecret = false;
    for (const field of fieldsToCheck) {
      if (scanForSecrets(field).hasSecret) {
        hasSecret = true;
        break;
      }
    }
    
    let dataToSave = { ...data };
    
    if (hasSecret) {
      console.warn(`[pi-memory] 🛡️ Secret detected in failure record. Saving redacted version.`);
      dataToSave = {
        ...data,
        approach: redactSecret(data.approach),
        error: redactSecret(data.error),
        reason: data.reason ? redactSecret(data.reason) : undefined,
        solution: data.solution ? redactSecret(data.solution) : undefined,
        context: data.context ? redactSecret(data.context) : undefined,
      };
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO failures (session_id, approach, error, reason, solution, context, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      dataToSave.sessionId,
      dataToSave.approach,
      dataToSave.error,
      dataToSave.reason || null,
      dataToSave.solution || null,
      dataToSave.context || null,
      Date.now()
    );

    return Number(result.lastInsertRowid);
  }

  getById(id: number): FailureRecord | undefined {
    return this.db.prepare(
      "SELECT * FROM failures WHERE id = ?"
    ).get(id) as FailureRecord | undefined;
  }

  search(query: string, limit: number = 10): FailureRecord[] {
    return this.db.prepare(`
      SELECT f.* FROM failures f
      JOIN failures_fts ft ON f.id = ft.rowid
      WHERE failures_fts MATCH ?
      ORDER BY f.timestamp DESC
      LIMIT ?
    `).all(query, limit) as FailureRecord[];
  }

  getRecent(limit: number = 20): FailureRecord[] {
    return this.db.prepare(`
      SELECT * FROM failures
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as FailureRecord[];
  }

  purgeOld(daysOld: number = 30): number {
    try {
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(
        "DELETE FROM failures WHERE timestamp < ?"
      ).run(cutoff);
      return result.changes;
    } catch {
      return 0;
    }
  }
}
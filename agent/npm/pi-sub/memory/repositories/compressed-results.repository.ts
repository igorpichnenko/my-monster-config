/**
 * compressed-results.repository.ts — Репозиторий для compressed_results.
 */

import type Database from "better-sqlite3";
import { scanForSecrets, redactSecret } from "../../context-tools/utils/secret-scanner.js";

export interface CompressedResult {
  id: number;
  original_hash: string;
  compressed: string;
  timestamp: number;
}

export class CompressedResultsRepository {
  constructor(private db: Database.Database) {}

  getByHash(originalHash: string): string | null {
    const row = this.db.prepare(
      "SELECT compressed FROM compressed_results WHERE original_hash = ?"
    ).get(originalHash) as { compressed: string } | undefined;
    return row?.compressed ?? null;
  }

  save(originalHash: string, compressed: string): number {
    const scanResult = scanForSecrets(compressed);
    let compressedToSave = compressed;
    
    if (scanResult.hasSecret) {
      compressedToSave = redactSecret(compressed);
    }
    
    const existing = this.db.prepare(
      "SELECT id FROM compressed_results WHERE original_hash = ?"
    ).get(originalHash) as { id: number } | undefined;
    
    if (existing) {
      this.db.prepare(`
        UPDATE compressed_results 
        SET compressed = ?, timestamp = ?
        WHERE original_hash = ?
      `).run(compressedToSave, Date.now(), originalHash);
      return existing.id;
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO compressed_results (original_hash, compressed, timestamp)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(originalHash, compressedToSave, Date.now());
    return Number(result.lastInsertRowid);
  }

  getById(id: number): CompressedResult | undefined {
    return this.db.prepare(
      "SELECT * FROM compressed_results WHERE id = ?"
    ).get(id) as CompressedResult | undefined;
  }

  search(query: string, limit: number = 10): CompressedResult[] {
    return this.db.prepare(`
      SELECT c.* FROM compressed_results c
      JOIN compressed_results_fts f ON c.id = f.rowid
      WHERE compressed_results_fts MATCH ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `).all(query, limit) as CompressedResult[];
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM compressed_results WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }
}
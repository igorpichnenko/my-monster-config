/**
 * duplicates.repository.ts — Репозиторий для code_duplicates.
 * 
 * v14: Добавлен для хранения дубликатов кода
 */

import type Database from "better-sqlite3";

export interface CodeDuplicate {
  id: number;
  project_path: string;
  file_path_1: string;
  file_path_2: string;
  line_start_1: number;
  line_end_1: number;
  line_start_2: number;
  line_end_2: number;
  lines_count: number;
  tokens_count: number;
  similarity: number;
  timestamp: number;
  session_id: string;
}

export class DuplicatesRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    projectPath: string;
    filePath1: string;
    filePath2: string;
    lineStart1: number;
    lineEnd1: number;
    lineStart2: number;
    lineEnd2: number;
    linesCount: number;
    tokensCount: number;
    similarity: number;
    sessionId: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO code_duplicates 
      (project_path, file_path_1, file_path_2, line_start_1, line_end_1,
       line_start_2, line_end_2, lines_count, tokens_count, similarity,
       timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.projectPath,
      data.filePath1,
      data.filePath2,
      data.lineStart1,
      data.lineEnd1,
      data.lineStart2,
      data.lineEnd2,
      data.linesCount,
      data.tokensCount,
      data.similarity,
      Date.now(),
      data.sessionId
    );

    return Number(result.lastInsertRowid);
  }

  getByProject(projectPath: string, limit: number = 100): CodeDuplicate[] {
    return this.db.prepare(`
      SELECT * FROM code_duplicates
      WHERE project_path = ?
      ORDER BY similarity DESC, timestamp DESC
      LIMIT ?
    `).all(projectPath, limit) as CodeDuplicate[];
  }

  getByFile(projectPath: string, filePath: string): CodeDuplicate[] {
    return this.db.prepare(`
      SELECT * FROM code_duplicates
      WHERE project_path = ? AND (file_path_1 = ? OR file_path_2 = ?)
      ORDER BY similarity DESC
    `).all(projectPath, filePath, filePath) as CodeDuplicate[];
  }

  getHighSimilarity(projectPath: string, minSimilarity: number = 0.8, limit: number = 50): CodeDuplicate[] {
    return this.db.prepare(`
      SELECT * FROM code_duplicates
      WHERE project_path = ? AND similarity >= ?
      ORDER BY similarity DESC
      LIMIT ?
    `).all(projectPath, minSimilarity, limit) as CodeDuplicate[];
  }

  search(query: string, projectPath: string, limit: number = 10): CodeDuplicate[] {
    return this.db.prepare(`
      SELECT d.* FROM code_duplicates d
      JOIN code_duplicates_fts f ON d.id = f.rowid
      WHERE code_duplicates_fts MATCH ?
        AND d.project_path = ?
      ORDER BY d.similarity DESC, d.timestamp DESC
      LIMIT ?
    `).all(query, projectPath, limit) as CodeDuplicate[];
  }

  deleteByFile(projectPath: string, filePath: string): number {
    const result = this.db.prepare(`
      DELETE FROM code_duplicates 
      WHERE project_path = ? AND (file_path_1 = ? OR file_path_2 = ?)
    `).run(projectPath, filePath, filePath);
    return result.changes;
  }
    deleteByProject(projectPath: string): number {
    const stmt = this.db.prepare(`DELETE FROM code_duplicates WHERE project_path = ?`);
    const result = stmt.run(projectPath);
    return result.changes;
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM code_duplicates WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }
}
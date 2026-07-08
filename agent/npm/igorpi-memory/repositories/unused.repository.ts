/**
 * unused.repository.ts — Репозиторий для unused_code.
 * 
 * v14: Добавлен для хранения неиспользуемого кода
 */

import type Database from "better-sqlite3";

export interface UnusedCode {
  id: number;
  project_path: string;
  file_path: string;
  symbol_name: string;
  symbol_type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'export';
  line: number;
  confidence: number;
  timestamp: number;
  session_id: string;
}

export class UnusedRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    projectPath: string;
    filePath: string;
    symbolName: string;
    symbolType: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'export';
    line: number;
    confidence: number;
    sessionId: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO unused_code 
      (project_path, file_path, symbol_name, symbol_type, line, confidence, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.projectPath,
      data.filePath,
      data.symbolName,
      data.symbolType,
      data.line,
      data.confidence,
      Date.now(),
      data.sessionId
    );

    return Number(result.lastInsertRowid);
  }

  getByProject(projectPath: string, limit: number = 100): UnusedCode[] {
    return this.db.prepare(`
      SELECT * FROM unused_code
      WHERE project_path = ?
      ORDER BY confidence DESC, timestamp DESC
      LIMIT ?
    `).all(projectPath, limit) as UnusedCode[];
  }

  getByFile(projectPath: string, filePath: string): UnusedCode[] {
    return this.db.prepare(`
      SELECT * FROM unused_code
      WHERE project_path = ? AND file_path = ?
      ORDER BY line
    `).all(projectPath, filePath) as UnusedCode[];
  }

  getByType(projectPath: string, symbolType: string, limit: number = 50): UnusedCode[] {
    return this.db.prepare(`
      SELECT * FROM unused_code
      WHERE project_path = ? AND symbol_type = ?
      ORDER BY confidence DESC
      LIMIT ?
    `).all(projectPath, symbolType, limit) as UnusedCode[];
  }

  search(query: string, projectPath: string, limit: number = 10): UnusedCode[] {
    return this.db.prepare(`
      SELECT u.* FROM unused_code u
      JOIN unused_code_fts f ON u.id = f.rowid
      WHERE unused_code_fts MATCH ?
        AND u.project_path = ?
      ORDER BY u.confidence DESC, u.timestamp DESC
      LIMIT ?
    `).all(query, projectPath, limit) as UnusedCode[];
  }

  deleteByFile(projectPath: string, filePath: string): number {
    const result = this.db.prepare(`
      DELETE FROM unused_code 
      WHERE project_path = ? AND file_path = ?
    `).run(projectPath, filePath);
    return result.changes;
  }
    deleteByProject(projectPath: string): number {
    const stmt = this.db.prepare(`DELETE FROM unused_code WHERE project_path = ?`);
    const result = stmt.run(projectPath);
    return result.changes;
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM unused_code WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }
}
/**
 * diagnostics.repository.ts — Репозиторий для code_diagnostics.
 * 
 * v14: Добавлен для хранения ошибок TypeScript/ESLint/Ruff/clangd
 */

import type Database from "better-sqlite3";

export interface CodeDiagnostic {
  id: number;
  project_path: string;
  file_path: string;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
  rule_id?: string;
  code?: string;
  message: string;
  suggestion?: string;
  fix_available: number;
  timestamp: number;
  session_id: string;
}

export class DiagnosticsRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    projectPath: string;
    filePath: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    severity: 'error' | 'warning' | 'info' | 'hint';
    source: string;
    ruleId?: string;
    code?: string;
    message: string;
    suggestion?: string;
    fixAvailable?: number;
    sessionId: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO code_diagnostics 
      (project_path, file_path, line, column, end_line, end_column, 
       severity, source, rule_id, code, message, suggestion, fix_available, 
       timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.projectPath,
      data.filePath,
      data.line,
      data.column,
      data.endLine || null,
      data.endColumn || null,
      data.severity,
      data.source,
      data.ruleId || null,
      data.code || null,
      data.message,
      data.suggestion || null,
      data.fixAvailable || 0,
      Date.now(),
      data.sessionId
    );

    return Number(result.lastInsertRowid);
  }

  getById(id: number): CodeDiagnostic | undefined {
    return this.db.prepare(
      "SELECT * FROM code_diagnostics WHERE id = ?"
    ).get(id) as CodeDiagnostic | undefined;
  }

  getByProject(projectPath: string, limit: number = 100): CodeDiagnostic[] {
    return this.db.prepare(`
      SELECT * FROM code_diagnostics
      WHERE project_path = ?
      ORDER BY severity, timestamp DESC
      LIMIT ?
    `).all(projectPath, limit) as CodeDiagnostic[];
  }

  getByFile(projectPath: string, filePath: string): CodeDiagnostic[] {
    return this.db.prepare(`
      SELECT * FROM code_diagnostics
      WHERE project_path = ? AND file_path = ?
      ORDER BY line, column
    `).all(projectPath, filePath) as CodeDiagnostic[];
  }

  getBySeverity(
    projectPath: string, 
    severity: 'error' | 'warning' | 'info' | 'hint', 
    limit: number = 50
  ): CodeDiagnostic[] {
    return this.db.prepare(`
      SELECT * FROM code_diagnostics
      WHERE project_path = ? AND severity = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(projectPath, severity, limit) as CodeDiagnostic[];
  }

  search(query: string, projectPath: string, limit: number = 10): CodeDiagnostic[] {
    return this.db.prepare(`
      SELECT d.* FROM code_diagnostics d
      JOIN code_diagnostics_fts f ON d.id = f.rowid
      WHERE code_diagnostics_fts MATCH ?
        AND d.project_path = ?
      ORDER BY d.severity, d.timestamp DESC
      LIMIT ?
    `).all(query, projectPath, limit) as CodeDiagnostic[];
  }

  deleteByFile(projectPath: string, filePath: string): number {
    const result = this.db.prepare(`
      DELETE FROM code_diagnostics 
      WHERE project_path = ? AND file_path = ?
    `).run(projectPath, filePath);
    return result.changes;
  }

  deleteByProject(projectPath: string): number {
    const result = this.db.prepare(`
      DELETE FROM code_diagnostics 
      WHERE project_path = ?
    `).run(projectPath);
    return result.changes;
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM code_diagnostics WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  getStats(projectPath: string): {
    total: number;
    errors: number;
    warnings: number;
    bySource: Record<string, number>;
  } {
    const total = (this.db.prepare(
      "SELECT COUNT(*) as count FROM code_diagnostics WHERE project_path = ?"
    ).get(projectPath) as { count: number }).count;

    const errors = (this.db.prepare(
      "SELECT COUNT(*) as count FROM code_diagnostics WHERE project_path = ? AND severity = 'error'"
    ).get(projectPath) as { count: number }).count;

    const warnings = (this.db.prepare(
      "SELECT COUNT(*) as count FROM code_diagnostics WHERE project_path = ? AND severity = 'warning'"
    ).get(projectPath) as { count: number }).count;

    const bySourceRows = this.db.prepare(`
      SELECT source, COUNT(*) as count
      FROM code_diagnostics
      WHERE project_path = ?
      GROUP BY source
    `).all(projectPath) as Array<{ source: string; count: number }>;

    const bySource: Record<string, number> = {};
    for (const row of bySourceRows) {
      bySource[row.source] = row.count;
    }

    return { total, errors, warnings, bySource };
  }
}
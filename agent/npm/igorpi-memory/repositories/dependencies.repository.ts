/**
 * dependencies.repository.ts — Репозиторий для code_dependencies.
 * 
 * v14: Добавлен для хранения зависимостей между файлами
 * v17.2: Добавлен метод deleteByFile для инкрементального анализа
 */

import type Database from "better-sqlite3";

export interface CodeDependency {
  id: number;
  project_path: string;
  file_path: string;
  depends_on: string;
  dependency_type: 'import' | 'require' | 'dynamic';
  is_circular: number;
  timestamp: number;
  session_id: string;
}

export class DependenciesRepository {
  constructor(private db: Database.Database) {}

  save(data: {
    projectPath: string;
    filePath: string;
    dependsOn: string;
    dependencyType: 'import' | 'require' | 'dynamic';
    isCircular?: number;
    sessionId: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO code_dependencies 
      (project_path, file_path, depends_on, dependency_type, is_circular, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.projectPath,
      data.filePath,
      data.dependsOn,
      data.dependencyType,
      data.isCircular || 0,
      Date.now(),
      data.sessionId
    );

    return Number(result.lastInsertRowid);
  }

  getByProject(projectPath: string, limit: number = 1000): CodeDependency[] {
    return this.db.prepare(`
      SELECT * FROM code_dependencies
      WHERE project_path = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(projectPath, limit) as CodeDependency[];
  }

  getDependenciesForFile(projectPath: string, filePath: string): CodeDependency[] {
    return this.db.prepare(`
      SELECT * FROM code_dependencies
      WHERE project_path = ? AND file_path = ?
    `).all(projectPath, filePath) as CodeDependency[];
  }

  getDependentsOf(projectPath: string, filePath: string): CodeDependency[] {
    return this.db.prepare(`
      SELECT * FROM code_dependencies
      WHERE project_path = ? AND depends_on = ?
    `).all(projectPath, filePath) as CodeDependency[];
  }

  getCircularDependencies(projectPath: string): CodeDependency[] {
    return this.db.prepare(`
      SELECT * FROM code_dependencies
      WHERE project_path = ? AND is_circular = 1
    `).all(projectPath) as CodeDependency[];
  }

  search(query: string, projectPath: string, limit: number = 10): CodeDependency[] {
    return this.db.prepare(`
      SELECT d.* FROM code_dependencies d
      JOIN code_dependencies_fts f ON d.id = f.rowid
      WHERE code_dependencies_fts MATCH ?
        AND d.project_path = ?
      ORDER BY d.timestamp DESC
      LIMIT ?
    `).all(query, projectPath, limit) as CodeDependency[];
  }

  deleteByProject(projectPath: string): number {
    const stmt = this.db.prepare(`DELETE FROM code_dependencies WHERE project_path = ?`);
    const result = stmt.run(projectPath);
    return result.changes;
  }

  /** v17.2: Удаляет зависимости для конкретного файла */
  deleteByFile(projectPath: string, filePath: string): number {
    const result = this.db.prepare(`
      DELETE FROM code_dependencies 
      WHERE project_path = ? AND file_path = ?
    `).run(projectPath, filePath);
    return result.changes;
  }

  purgeOld(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM code_dependencies WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }
}
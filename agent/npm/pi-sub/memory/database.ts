/**
 * database.ts — SQLite + FTS5 ядро памяти для pi-sub-unified.
 *
 * Единая точка доступа к БД для всех компонентов:
 * - tool-interceptor (перехват вывода инструментов)
 * - result-compressor (кэш сжатых результатов)
 * - session-memory (долговременная память между сессиями)
 *
 * Архитектура:
 * - Singleton (один экземпляр на проект)
 * - WAL mode для лучшей производительности при параллельном доступе
 * - FTS5 для полнотекстового поиска
 * - Автоматическая миграция схемы при изменениях
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** Версия схемы БД. Увеличивать при изменениях структуры. */
const SCHEMA_VERSION = 1;

/** Путь к БД относительно корня проекта. */
const DB_RELATIVE_PATH = ".pi/memory/unified.db";

export interface ToolOutput {
  id: number;
  tool_name: string;
  args: string;
  output: string;
  summary: string;
  timestamp: number;
  size: number;
}

export interface SubagentResult {
  id: string;
  agent_type: string;
  description: string;
  result: string;
  timestamp: number;
  status: string;
  tool_uses: number;
  duration_ms: number;
}

export interface SessionFact {
  id: number;
  session_id: string;
  fact_type: "decision" | "lesson" | "preference" | "architecture" | "api";
  content: string;
  timestamp: number;
}

export interface CompressedResult {
  original_hash: string;
  compressed: string;
  timestamp: number;
}

export class MemoryDatabase {
  private db: Database.Database;
  private static instance: MemoryDatabase | null = null;

  private constructor(dbFilePath: string) {
    // Создаём директорию если её нет
    const dir = dirname(dbFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Инициализируем БД с WAL mode для лучшей производительности
    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -64000"); // 64MB кэш

    // Инициализируем схему
    this.initSchema();
  }

  /** Singleton: получить экземпляр БД для проекта. */
  static getInstance(projectDir: string = process.cwd()): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      const dbPath = join(projectDir, DB_RELATIVE_PATH);
      MemoryDatabase.instance = new MemoryDatabase(dbPath);
    }
    return MemoryDatabase.instance;
  }

  /** 
   * Singleton: получить экземпляр БД по явному пути к файлу.
   * Используется MCP сервером для работы с общей БД.
   */
  static getInstanceWithPath(dbFilePath: string): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      MemoryDatabase.instance = new MemoryDatabase(dbFilePath);
    }
    return MemoryDatabase.instance;
  }

  /** Сбросить singleton (для тестов). */
  static resetInstance(): void {
    if (MemoryDatabase.instance) {
      MemoryDatabase.instance.close();
      MemoryDatabase.instance = null;
    }
  }

  /** Инициализация схемы БД. */
  private initSchema(): void {
    // Таблица версий для миграций
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);

    const currentVersion = this.db.prepare(
      "SELECT version FROM schema_version LIMIT 1"
    ).get() as { version: number } | undefined;

    if (!currentVersion) {
      // Первая инициализация — создаём все таблицы
      this.db.exec(`
        -- Перехваченные выводы инструментов
        CREATE TABLE IF NOT EXISTS tool_outputs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_name TEXT NOT NULL,
          args TEXT,
          output TEXT NOT NULL,
          summary TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          size INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tool_outputs_timestamp 
          ON tool_outputs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool 
          ON tool_outputs(tool_name);

        -- FTS5 для поиска по выводам инструментов
        CREATE VIRTUAL TABLE IF NOT EXISTS tool_outputs_fts USING fts5(
          tool_name, args, output, summary,
          content='tool_outputs',
          content_rowid='id',
          tokenize='unicode61'
        );

        -- Триггеры для синхронизации FTS5 с основной таблицей
        CREATE TRIGGER IF NOT EXISTS tool_outputs_ai AFTER INSERT ON tool_outputs BEGIN
          INSERT INTO tool_outputs_fts(rowid, tool_name, args, output, summary)
          VALUES (new.id, new.tool_name, new.args, new.output, new.summary);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_outputs_ad AFTER DELETE ON tool_outputs BEGIN
          INSERT INTO tool_outputs_fts(tool_outputs_fts, rowid, tool_name, args, output, summary)
          VALUES ('delete', old.id, old.tool_name, old.args, old.output, old.summary);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_outputs_au AFTER UPDATE ON tool_outputs BEGIN
          INSERT INTO tool_outputs_fts(tool_outputs_fts, rowid, tool_name, args, output, summary)
          VALUES ('delete', old.id, old.tool_name, old.args, old.output, old.summary);
          INSERT INTO tool_outputs_fts(rowid, tool_name, args, output, summary)
          VALUES (new.id, new.tool_name, new.args, new.output, new.summary);
        END;

        -- Результаты субагентов
        CREATE TABLE IF NOT EXISTS subagent_results (
          id TEXT PRIMARY KEY,
          agent_type TEXT NOT NULL,
          description TEXT NOT NULL,
          result TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          status TEXT NOT NULL,
          tool_uses INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_subagent_results_timestamp 
          ON subagent_results(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_subagent_results_status 
          ON subagent_results(status);

        -- FTS5 для поиска по результатам субагентов
        CREATE VIRTUAL TABLE IF NOT EXISTS subagent_results_fts USING fts5(
          agent_type, description, result,
          content='subagent_results',
          content_rowid='rowid',
          tokenize='unicode61'
        );

        -- Факты между сессиями (долговременная память)
        CREATE TABLE IF NOT EXISTS session_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          fact_type TEXT NOT NULL CHECK(fact_type IN ('decision', 'lesson', 'preference', 'architecture', 'api')),
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_facts_timestamp 
          ON session_facts(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_session_facts_type 
          ON session_facts(fact_type);

        -- FTS5 для поиска по фактам
        CREATE VIRTUAL TABLE IF NOT EXISTS session_facts_fts USING fts5(
          fact_type, content,
          content='session_facts',
          content_rowid='id',
          tokenize='unicode61'
        );

        -- Триггеры для session_facts FTS5
        CREATE TRIGGER IF NOT EXISTS session_facts_ai AFTER INSERT ON session_facts BEGIN
          INSERT INTO session_facts_fts(rowid, fact_type, content)
          VALUES (new.id, new.fact_type, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_facts_ad AFTER DELETE ON session_facts BEGIN
          INSERT INTO session_facts_fts(session_facts_fts, rowid, fact_type, content)
          VALUES ('delete', old.id, old.fact_type, old.content);
        END;

        -- Кэш сжатых результатов (чтобы не сжимать одно и то же дважды)
        CREATE TABLE IF NOT EXISTS compressed_results (
          original_hash TEXT PRIMARY KEY,
          compressed TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_compressed_results_timestamp 
          ON compressed_results(timestamp DESC);

        -- Сохраняем версию схемы
        INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});
      `);
    } else if (currentVersion.version < SCHEMA_VERSION) {
      // TODO: Миграции для будущих версий
      // this.migrate(currentVersion.version);
      this.db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    }
  }

  /** Закрыть соединение с БД. */
  close(): void {
    this.db.close();
  }

  /** Получить raw Database для продвинутых операций. */
  getRaw(): Database.Database {
    return this.db;
  }

  // =========================================================================
  // Tool Outputs
  // =========================================================================

  /** Сохранить перехваченный вывод инструмента. */
  saveToolOutput(data: {
    toolName: string;
    args: string;
    output: string;
    summary: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO tool_outputs (tool_name, args, output, summary, timestamp, size)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.toolName,
      data.args,
      data.output,
      data.summary,
      Date.now(),
      data.output.length
    );

    return Number(result.lastInsertRowid);
  }

  /** Получить полный вывод инструмента по ID. */
  getToolOutput(id: number): ToolOutput | undefined {
    return this.db.prepare(
      "SELECT * FROM tool_outputs WHERE id = ?"
    ).get(id) as ToolOutput | undefined;
  }

  /** Поиск по выводам инструментов через FTS5. */
  searchToolOutputs(query: string, limit: number = 10): ToolOutput[] {
    return this.db.prepare(`
      SELECT t.* FROM tool_outputs t
      JOIN tool_outputs_fts f ON t.id = f.rowid
      WHERE tool_outputs_fts MATCH ?
      ORDER BY t.timestamp DESC
      LIMIT ?
    `).all(query, limit) as ToolOutput[];
  }

    getRecentToolOutputs(limit: number = 10): ToolOutput[] {
    return this.db.prepare(`
      SELECT * FROM tool_outputs
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as ToolOutput[];
  }

  /** Удалить старые выводы инструментов (старше N дней). */
  purgeOldToolOutputs(daysOld: number = 7): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM tool_outputs WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  // =========================================================================
  // Subagent Results
  // =========================================================================

  /** Сохранить результат субагента. */
  saveSubagentResult(data: {
    id: string;
    agentType: string;
    description: string;
    result: string;
    status: string;
    toolUses: number;
    durationMs: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO subagent_results 
      (id, agent_type, description, result, timestamp, status, tool_uses, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.agentType,
      data.description,
      data.result,
      Date.now(),
      data.status,
      data.toolUses,
      data.durationMs
    );
  }

  /** Получить результат субагента по ID. */
  getSubagentResult(id: string): SubagentResult | undefined {
    return this.db.prepare(
      "SELECT * FROM subagent_results WHERE id = ?"
    ).get(id) as SubagentResult | undefined;
  }

  /** Поиск по результатам субагентов через FTS5. */
  searchSubagentResults(query: string, limit: number = 10): SubagentResult[] {
    return this.db.prepare(`
      SELECT s.* FROM subagent_results s
      JOIN subagent_results_fts f ON s.rowid = f.rowid
      WHERE subagent_results_fts MATCH ?
      ORDER BY s.timestamp DESC
      LIMIT ?
    `).all(query, limit) as SubagentResult[];
  }

  // =========================================================================
  // Session Facts (долговременная память)
  // =========================================================================

  /** Сохранить факт из сессии. */
  saveFact(data: {
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

  /** Поиск по фактам через FTS5. */
  searchFacts(query: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT f.* FROM session_facts f
      JOIN session_facts_fts ft ON f.id = ft.rowid
      WHERE session_facts_fts MATCH ?
      ORDER BY f.timestamp DESC
      LIMIT ?
    `).all(query, limit) as SessionFact[];
  }

/** Поиск по фактам через LIKE (для частичных совпадений). */
  searchFactsLike(pattern: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT * FROM session_facts
      WHERE content LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(pattern, limit) as SessionFact[];
  }
  
  /** Получить последние N фактов. */
  getRecentFacts(limit: number = 20): SessionFact[] {
    return this.db.prepare(`
      SELECT * FROM session_facts
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as SessionFact[];
  }

  /** Удалить старые факты (старше N дней). */
  purgeOldFacts(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM session_facts WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  // =========================================================================
  // Compressed Results Cache
  // =========================================================================

  /** Получить сжатый результат из кэша (по хэшу оригинала). */
  getCompressedResult(originalHash: string): string | null {
    const row = this.db.prepare(
      "SELECT compressed FROM compressed_results WHERE original_hash = ?"
    ).get(originalHash) as { compressed: string } | undefined;
    return row?.compressed ?? null;
  }

  /** Сохранить сжатый результат в кэш. */
  saveCompressedResult(originalHash: string, compressed: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO compressed_results (original_hash, compressed, timestamp)
      VALUES (?, ?, ?)
    `).run(originalHash, compressed, Date.now());
  }

  // =========================================================================
  // Статистика
  // =========================================================================

  /** Получить статистику по БД. */
  getStats(): {
    toolOutputs: number;
    subagentResults: number;
    sessionFacts: number;
    compressedResults: number;
    dbSizeMb: number;
  } {
    const toolOutputs = (this.db.prepare(
      "SELECT COUNT(*) as count FROM tool_outputs"
    ).get() as { count: number }).count;

    const subagentResults = (this.db.prepare(
      "SELECT COUNT(*) as count FROM subagent_results"
    ).get() as { count: number }).count;

    const sessionFacts = (this.db.prepare(
      "SELECT COUNT(*) as count FROM session_facts"
    ).get() as { count: number }).count;

    const compressedResults = (this.db.prepare(
      "SELECT COUNT(*) as count FROM compressed_results"
    ).get() as { count: number }).count;

    // Размер БД в MB
    const pageInfo = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const pageSize = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    const dbSizeMb = (pageInfo.page_count * pageSize.page_size) / (1024 * 1024);

    return { toolOutputs, subagentResults, sessionFacts, compressedResults, dbSizeMb };
  }
}
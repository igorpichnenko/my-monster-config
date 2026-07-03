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
 * - FTS5 для полнотекстового поиска ПО ВСЕМ ТАБЛИЦАМ
 * - Автоматическая миграция схемы при изменениях
 * - Поиск корневого .pi вверх по дереву (как git ищет .git)
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/** Версия схемы БД. Увеличивать при изменениях структуры. */
const SCHEMA_VERSION = 5;

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
  id: number;  // ← ДОБАВЛЕНО: surrogate key для FTS5
  original_hash: string;
  compressed: string;
  timestamp: number;
}

export interface CompactionSummary {
  id: number;
  session_id: string;
  reason: "manual" | "threshold" | "overflow";
  tokens_before: number;
  summary: string;
  detailed_summary: string;
  timestamp: number;
}

/**
 * Найти корневую директорию проекта (аналог того, как git ищет .git).
 */
function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);
  const root = resolve("/");
  
  while (current !== root) {
    const piDir = join(current, ".pi");
    if (existsSync(piDir)) {
      return current;
    }
    current = dirname(current);
  }
  
  return startDir;
}

export class MemoryDatabase {
  private db: Database.Database;
  private static instance: MemoryDatabase | null = null;

  private constructor(dbFilePath: string) {
    const dir = dirname(dbFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -64000"); // 64MB кэш

    this.initSchema();
  }

  static getInstance(projectDir: string = process.cwd()): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      const projectRoot = findProjectRoot(projectDir);
      const dbPath = join(projectRoot, DB_RELATIVE_PATH);
      MemoryDatabase.instance = new MemoryDatabase(dbPath);
    }
    return MemoryDatabase.instance;
  }

  static getInstanceWithPath(dbFilePath: string): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      MemoryDatabase.instance = new MemoryDatabase(dbFilePath);
    }
    return MemoryDatabase.instance;
  }

  static resetInstance(): void {
    if (MemoryDatabase.instance) {
      MemoryDatabase.instance.close();
      MemoryDatabase.instance = null;
    }
  }

  private initSchema(): void {
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

        CREATE VIRTUAL TABLE IF NOT EXISTS tool_outputs_fts USING fts5(
          tool_name, args, output, summary,
          content='tool_outputs',
          content_rowid='id',
          tokenize='unicode61'
        );

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

        CREATE VIRTUAL TABLE IF NOT EXISTS session_facts_fts USING fts5(
          fact_type, content,
          content='session_facts',
          content_rowid='id',
          tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS session_facts_ai AFTER INSERT ON session_facts BEGIN
          INSERT INTO session_facts_fts(rowid, fact_type, content)
          VALUES (new.id, new.fact_type, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_facts_ad AFTER DELETE ON session_facts BEGIN
          INSERT INTO session_facts_fts(session_facts_fts, rowid, fact_type, content)
          VALUES ('delete', old.id, old.fact_type, old.content);
        END;

        -- Кэш сжатых результатов (теперь с FTS5!)
        CREATE TABLE IF NOT EXISTS compressed_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_hash TEXT NOT NULL UNIQUE,
          compressed TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_compressed_results_timestamp 
          ON compressed_results(timestamp DESC);

        -- FTS5 для поиска по сжатым результатам
        CREATE VIRTUAL TABLE IF NOT EXISTS compressed_results_fts USING fts5(
          original_hash, compressed,
          content='compressed_results',
          content_rowid='id',
          tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS compressed_results_ai AFTER INSERT ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(rowid, original_hash, compressed)
          VALUES (new.id, new.original_hash, new.compressed);
        END;

        CREATE TRIGGER IF NOT EXISTS compressed_results_ad AFTER DELETE ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(compressed_results_fts, rowid, original_hash, compressed)
          VALUES ('delete', old.id, old.original_hash, old.compressed);
        END;

        CREATE TRIGGER IF NOT EXISTS compressed_results_au AFTER UPDATE ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(compressed_results_fts, rowid, original_hash, compressed)
          VALUES ('delete', old.id, old.original_hash, old.compressed);
          INSERT INTO compressed_results_fts(rowid, original_hash, compressed)
          VALUES (new.id, new.original_hash, new.compressed);
        END;

        -- Summaries компакции
        CREATE TABLE IF NOT EXISTS compaction_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          reason TEXT NOT NULL CHECK(reason IN ('manual', 'threshold', 'overflow')),
          tokens_before INTEGER NOT NULL,
          summary TEXT NOT NULL,
          detailed_summary TEXT NOT NULL DEFAULT '',
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_compaction_summaries_timestamp 
          ON compaction_summaries(timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_compaction_summaries_session
          ON compaction_summaries(session_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS compaction_summaries_fts USING fts5(
          reason, summary, detailed_summary,
          content='compaction_summaries',
          content_rowid='id',
          tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_ai AFTER INSERT ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(rowid, reason, summary, detailed_summary)
          VALUES (new.id, new.reason, new.summary, new.detailed_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_ad AFTER DELETE ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(compaction_summaries_fts, rowid, reason, summary, detailed_summary)
          VALUES ('delete', old.id, old.reason, old.summary, old.detailed_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_au AFTER UPDATE ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(compaction_summaries_fts, rowid, reason, summary, detailed_summary)
          VALUES ('delete', old.id, old.reason, old.summary, old.detailed_summary);
          INSERT INTO compaction_summaries_fts(rowid, reason, summary, detailed_summary)
          VALUES (new.id, new.reason, new.summary, new.detailed_summary);
        END;

        INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});
      `);
    } else if (currentVersion.version < SCHEMA_VERSION) {
      this.migrate(currentVersion.version);
    }
  }

  private migrate(fromVersion: number): void {
    console.log(`[pi-sub] Migrating schema from v${fromVersion} to v${SCHEMA_VERSION}`);

    if (fromVersion < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS compaction_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          reason TEXT NOT NULL CHECK(reason IN ('manual', 'threshold', 'overflow')),
          tokens_before INTEGER NOT NULL,
          summary TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_compaction_summaries_timestamp 
          ON compaction_summaries(timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_compaction_summaries_session 
          ON compaction_summaries(session_id);
      `);
    }

    if (fromVersion < 3) {
      const columns = this.db.prepare("PRAGMA table_info(compaction_summaries)").all() as Array<{ name: string }>;
      const hasDetailedSummary = columns.some(c => c.name === "detailed_summary");
      
      if (!hasDetailedSummary) {
        this.db.exec(`
          ALTER TABLE compaction_summaries ADD COLUMN detailed_summary TEXT NOT NULL DEFAULT ''
        `);
      }
    }

    if (fromVersion < 4) {
      this.db.exec(`
        DROP TABLE IF EXISTS compaction_summaries_fts
      `);
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS compaction_summaries_fts USING fts5(
          reason, summary, detailed_summary,
          content='compaction_summaries',
          content_rowid='id',
          tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_ai AFTER INSERT ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(rowid, reason, summary, detailed_summary)
          VALUES (new.id, new.reason, new.summary, new.detailed_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_ad AFTER DELETE ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(compaction_summaries_fts, rowid, reason, summary, detailed_summary)
          VALUES ('delete', old.id, old.reason, old.summary, old.detailed_summary);
        END;

        CREATE TRIGGER IF NOT EXISTS compaction_summaries_au AFTER UPDATE ON compaction_summaries BEGIN
          INSERT INTO compaction_summaries_fts(compaction_summaries_fts, rowid, reason, summary, detailed_summary)
          VALUES ('delete', old.id, old.reason, old.summary, old.detailed_summary);
          INSERT INTO compaction_summaries_fts(rowid, reason, summary, detailed_summary)
          VALUES (new.id, new.reason, new.summary, new.detailed_summary);
        END;
      `);
    }

    if (fromVersion < 5) {
      // v4 → v5: Добавляем FTS5 для compressed_results
      console.log(`[pi-sub] Migrating to v5: Adding FTS5 for compressed_results`);
      
      this.db.exec(`
        -- Создаём новую таблицу с id
        CREATE TABLE IF NOT EXISTS compressed_results_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_hash TEXT NOT NULL UNIQUE,
          compressed TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        -- Копируем данные из старой таблицы
        INSERT INTO compressed_results_new (original_hash, compressed, timestamp)
        SELECT original_hash, compressed, timestamp FROM compressed_results;

        -- Удаляем старую таблицу
        DROP TABLE compressed_results;

        -- Переименовываем новую таблицу
        ALTER TABLE compressed_results_new RENAME TO compressed_results;

        -- Создаём индекс
        CREATE INDEX IF NOT EXISTS idx_compressed_results_timestamp 
          ON compressed_results(timestamp DESC);

        -- Создаём FTS5 индекс
        CREATE VIRTUAL TABLE IF NOT EXISTS compressed_results_fts USING fts5(
          original_hash, compressed,
          content='compressed_results',
          content_rowid='id',
          tokenize='unicode61'
        );

        -- Создаём триггеры
        CREATE TRIGGER IF NOT EXISTS compressed_results_ai AFTER INSERT ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(rowid, original_hash, compressed)
          VALUES (new.id, new.original_hash, new.compressed);
        END;

        CREATE TRIGGER IF NOT EXISTS compressed_results_ad AFTER DELETE ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(compressed_results_fts, rowid, original_hash, compressed)
          VALUES ('delete', old.id, old.original_hash, old.compressed);
        END;

        CREATE TRIGGER IF NOT EXISTS compressed_results_au AFTER UPDATE ON compressed_results BEGIN
          INSERT INTO compressed_results_fts(compressed_results_fts, rowid, original_hash, compressed)
          VALUES ('delete', old.id, old.original_hash, old.compressed);
          INSERT INTO compressed_results_fts(rowid, original_hash, compressed)
          VALUES (new.id, new.original_hash, new.compressed);
        END;
      `);
    }

    this.db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
    console.log(`[pi-sub] Schema migrated to v${SCHEMA_VERSION}`);
  }

  getRaw(): Database.Database {
    return this.db;
  }

  // =========================================================================
  // Tool Outputs
  // =========================================================================

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

  getToolOutput(id: number): ToolOutput | undefined {
    return this.db.prepare(
      "SELECT * FROM tool_outputs WHERE id = ?"
    ).get(id) as ToolOutput | undefined;
  }

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

  getSubagentResult(id: string): SubagentResult | undefined {
    return this.db.prepare(
      "SELECT * FROM subagent_results WHERE id = ?"
    ).get(id) as SubagentResult | undefined;
  }

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

  getFactById(id: number): SessionFact | undefined {
    return this.db.prepare(
      "SELECT * FROM session_facts WHERE id = ?"
    ).get(id) as SessionFact | undefined;
  }

  searchFacts(query: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT f.* FROM session_facts f
      JOIN session_facts_fts ft ON f.id = ft.rowid
      WHERE session_facts_fts MATCH ?
      ORDER BY f.timestamp DESC
      LIMIT ?
    `).all(query, limit) as SessionFact[];
  }

  searchFactsLike(pattern: string, limit: number = 10): SessionFact[] {
    return this.db.prepare(`
      SELECT * FROM session_facts
      WHERE content LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(pattern, limit) as SessionFact[];
  }
  
  getRecentFacts(limit: number = 20): SessionFact[] {
    return this.db.prepare(`
      SELECT * FROM session_facts
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as SessionFact[];
  }

  purgeOldFacts(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM session_facts WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  // =========================================================================
  // Compressed Results Cache (теперь с FTS5!)
  // =========================================================================

  getCompressedResult(originalHash: string): string | null {
    const row = this.db.prepare(
      "SELECT compressed FROM compressed_results WHERE original_hash = ?"
    ).get(originalHash) as { compressed: string } | undefined;
    return row?.compressed ?? null;
  }

  saveCompressedResult(originalHash: string, compressed: string): number {
    // Проверяем существует ли уже
    const existing = this.db.prepare(
      "SELECT id FROM compressed_results WHERE original_hash = ?"
    ).get(originalHash) as { id: number } | undefined;
    
    if (existing) {
      // Обновляем существующую запись
      this.db.prepare(`
        UPDATE compressed_results 
        SET compressed = ?, timestamp = ?
        WHERE original_hash = ?
      `).run(compressed, Date.now(), originalHash);
      return existing.id;
    }
    
    // Создаём новую запись
    const stmt = this.db.prepare(`
      INSERT INTO compressed_results (original_hash, compressed, timestamp)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(originalHash, compressed, Date.now());
    return Number(result.lastInsertRowid);
  }

  getCompressedResultById(id: number): CompressedResult | undefined {
    return this.db.prepare(
      "SELECT * FROM compressed_results WHERE id = ?"
    ).get(id) as CompressedResult | undefined;
  }

  searchCompressedResults(query: string, limit: number = 10): CompressedResult[] {
    return this.db.prepare(`
      SELECT c.* FROM compressed_results c
      JOIN compressed_results_fts f ON c.id = f.rowid
      WHERE compressed_results_fts MATCH ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `).all(query, limit) as CompressedResult[];
  }

  purgeOldCompressedResults(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM compressed_results WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  // =========================================================================
  // Compaction Summaries
  // =========================================================================

  saveCompactionSummary(data: {
    sessionId: string;
    reason: "manual" | "threshold" | "overflow";
    tokensBefore: number;
    summary: string;
    detailedSummary?: string;
  }): number {
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
      data.detailedSummary || "",
      Date.now()
    );

    return Number(result.lastInsertRowid);
  }

  getCompactionSummaryById(id: number): CompactionSummary | undefined {
    return this.db.prepare(
      "SELECT * FROM compaction_summaries WHERE id = ?"
    ).get(id) as CompactionSummary | undefined;
  }

  getCompactionSummaries(sessionId: string, limit: number = 10): CompactionSummary[] {
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

  searchCompactionSummaries(query: string, limit: number = 10): CompactionSummary[] {
    return this.db.prepare(`
      SELECT c.* FROM compaction_summaries c
      JOIN compaction_summaries_fts f ON c.id = f.rowid
      WHERE compaction_summaries_fts MATCH ?
      ORDER BY c.timestamp DESC
      LIMIT ?
    `).all(query, limit) as CompactionSummary[];
  }

  purgeOldCompactionSummaries(daysOld: number = 30): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM compaction_summaries WHERE timestamp < ?"
    ).run(cutoff);
    return result.changes;
  }

  // =========================================================================
  // Статистика
  // =========================================================================

  getStats(): {
    toolOutputs: number;
    subagentResults: number;
    sessionFacts: number;
    compressedResults: number;
    compactionSummaries: number;
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

    const compactionSummaries = (this.db.prepare(
      "SELECT COUNT(*) as count FROM compaction_summaries"
    ).get() as { count: number }).count;

    const pageInfo = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const pageSize = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    const dbSizeMb = (pageInfo.page_count * pageSize.page_size) / (1024 * 1024);

    return { 
      toolOutputs, 
      subagentResults, 
      sessionFacts, 
      compressedResults,
      compactionSummaries, 
      dbSizeMb 
    };
  }
}
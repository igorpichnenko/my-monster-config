/**
 * schema.ts — Схема БД и миграции.
 * 
 * v10: Добавлен триггер UPDATE для session_facts (критическое исправление)
 * v11: Добавлен project_path в session_facts для изоляции между проектами
 */

import type Database from "better-sqlite3";

/** Версия схемы БД. Увеличивать при изменениях структуры. */
export const SCHEMA_VERSION = 1;

/**
 * Инициализирует схему БД.
 * Если БД пустая — создаёт все таблицы.
 * Если версия устарела — запускает миграции.
 */
export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const currentVersion = db.prepare(
    "SELECT version FROM schema_version LIMIT 1"
  ).get() as { version: number } | undefined;

  if (!currentVersion) {
    createAllTables(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else {
    // Миграции: добавляем отсутствующие таблицы
    ensureTable(db, "failures",
      `CREATE TABLE IF NOT EXISTS failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        approach TEXT NOT NULL,
        error TEXT NOT NULL,
        reason TEXT,
        solution TEXT,
        context TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_failures_timestamp ON failures(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_failures_session ON failures(session_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS failures_fts USING fts5(
        approach, error, reason, solution, context,
        content='failures', content_rowid='id', tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS failures_ai AFTER INSERT ON failures BEGIN
        INSERT INTO failures_fts(rowid, approach, error, reason, solution, context)
        VALUES (new.id, new.approach, new.error, new.reason, new.solution, new.context);
      END;
      CREATE TRIGGER IF NOT EXISTS failures_ad AFTER DELETE ON failures BEGIN
        INSERT INTO failures_fts(failures_fts, rowid, approach, error, reason, solution, context)
        VALUES ('delete', old.id, old.approach, old.error, old.reason, new.solution, new.context);
      END;
      CREATE TRIGGER IF NOT EXISTS failures_au AFTER UPDATE ON failures BEGIN
        INSERT INTO failures_fts(failures_fts, rowid, approach, error, reason, solution, context)
        VALUES ('delete', old.id, old.approach, old.error, old.reason, old.solution, old.context);
        INSERT INTO failures_fts(rowid, approach, error, reason, solution, context)
        VALUES (new.id, new.approach, new.error, new.reason, new.solution, new.context);
      END;`
    );
  }

}

/**
 * Проверяет существование таблицы и создаёт если нужно.
 */
function ensureTable(db: Database.Database, tableName: string, sql: string): void {
  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { name: string } | undefined;
  if (!exists) {
    db.exec(sql);
  }
}

/**
 * Создаёт все таблицы с нуля.
 */
function createAllTables(db: Database.Database): void {
  db.exec(`
    -- Tool Outputs (с deduplication и priority)
    CREATE TABLE IF NOT EXISTS tool_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      args TEXT,
      output TEXT NOT NULL,
      summary TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      size INTEGER NOT NULL,
      content_hash TEXT,
      priority INTEGER NOT NULL DEFAULT 5
    );

    CREATE INDEX IF NOT EXISTS idx_tool_outputs_timestamp 
      ON tool_outputs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool 
      ON tool_outputs(tool_name);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_hash
      ON tool_outputs(content_hash);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_priority
      ON tool_outputs(priority DESC);

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

    -- Subagent Results
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

    CREATE TRIGGER IF NOT EXISTS subagent_results_ai AFTER INSERT ON subagent_results BEGIN
      INSERT INTO subagent_results_fts(rowid, agent_type, description, result)
      VALUES (new.rowid, new.agent_type, new.description, new.result);
    END;

    CREATE TRIGGER IF NOT EXISTS subagent_results_ad AFTER DELETE ON subagent_results BEGIN
      INSERT INTO subagent_results_fts(subagent_results_fts, rowid, agent_type, description, result)
      VALUES ('delete', old.rowid, old.agent_type, old.description, old.result);
    END;

    CREATE TRIGGER IF NOT EXISTS subagent_results_au AFTER UPDATE ON subagent_results BEGIN
      INSERT INTO subagent_results_fts(subagent_results_fts, rowid, agent_type, description, result)
      VALUES ('delete', old.rowid, old.agent_type, old.description, old.result);
      INSERT INTO subagent_results_fts(rowid, agent_type, description, result)
      VALUES (new.rowid, new.agent_type, new.description, new.result);
    END;

    -- Session Facts (с project_path для изоляции между проектами)
    CREATE TABLE IF NOT EXISTS session_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      fact_type TEXT NOT NULL CHECK(fact_type IN ('decision', 'lesson', 'preference', 'architecture', 'api')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      project_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_facts_timestamp 
      ON session_facts(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_session_facts_type 
      ON session_facts(fact_type);
    CREATE INDEX IF NOT EXISTS idx_session_facts_project
      ON session_facts(project_path);

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

    -- v10: КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ — добавлен триггер UPDATE для session_facts
    -- Без него consolidation.ts обновляет контент, но FTS5 индекс остаётся старым
    CREATE TRIGGER IF NOT EXISTS session_facts_au AFTER UPDATE ON session_facts BEGIN
      INSERT INTO session_facts_fts(session_facts_fts, rowid, fact_type, content)
      VALUES ('delete', old.id, old.fact_type, old.content);
      INSERT INTO session_facts_fts(rowid, fact_type, content)
      VALUES (new.id, new.fact_type, new.content);
    END;

    -- Compressed Results Cache
    CREATE TABLE IF NOT EXISTS compressed_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_hash TEXT NOT NULL UNIQUE,
      compressed TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_compressed_results_timestamp 
      ON compressed_results(timestamp DESC);

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

    -- Compaction Summaries
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

    -- Compaction Keywords
    CREATE TABLE IF NOT EXISTS compaction_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compaction_id INTEGER NOT NULL,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('file', 'decision', 'lesson')),
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (compaction_id) REFERENCES compaction_summaries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_compaction_keywords_compaction 
      ON compaction_keywords(compaction_id);
    CREATE INDEX IF NOT EXISTS idx_compaction_keywords_category 
      ON compaction_keywords(category);
    CREATE INDEX IF NOT EXISTS idx_compaction_keywords_timestamp 
      ON compaction_keywords(timestamp DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS compaction_keywords_fts USING fts5(
      keyword,
      content='compaction_keywords',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS compaction_keywords_ai AFTER INSERT ON compaction_keywords BEGIN
      INSERT INTO compaction_keywords_fts(rowid, keyword)
      VALUES (new.id, new.keyword);
    END;

    CREATE TRIGGER IF NOT EXISTS compaction_keywords_ad AFTER DELETE ON compaction_keywords BEGIN
      INSERT INTO compaction_keywords_fts(compaction_keywords_fts, rowid, keyword)
      VALUES ('delete', old.id, old.keyword);
    END;

    CREATE TRIGGER IF NOT EXISTS compaction_keywords_au AFTER UPDATE ON compaction_keywords BEGIN
      INSERT INTO compaction_keywords_fts(compaction_keywords_fts, rowid, keyword)
      VALUES ('delete', old.id, old.keyword);
      INSERT INTO compaction_keywords_fts(rowid, keyword)
      VALUES (new.id, new.keyword);
    END;

    -- Failures
    CREATE TABLE IF NOT EXISTS failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      approach TEXT NOT NULL,
      error TEXT NOT NULL,
      reason TEXT,
      solution TEXT,
      context TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_failures_timestamp 
      ON failures(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_failures_session
      ON failures(session_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS failures_fts USING fts5(
      approach, error, reason, solution, context,
      content='failures',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS failures_ai AFTER INSERT ON failures BEGIN
      INSERT INTO failures_fts(rowid, approach, error, reason, solution, context)
      VALUES (new.id, new.approach, new.error, new.reason, new.solution, new.context);
    END;

    CREATE TRIGGER IF NOT EXISTS failures_ad AFTER DELETE ON failures BEGIN
      INSERT INTO failures_fts(failures_fts, rowid, approach, error, reason, solution, context)
      VALUES ('delete', old.id, old.approach, old.error, old.reason, old.solution, old.context);
    END;

    CREATE TRIGGER IF NOT EXISTS failures_au AFTER UPDATE ON failures BEGIN
      INSERT INTO failures_fts(failures_fts, rowid, approach, error, reason, solution, context)
      VALUES ('delete', old.id, old.approach, old.error, old.reason, old.solution, old.context);
      INSERT INTO failures_fts(rowid, approach, error, reason, solution, context)
      VALUES (new.id, new.approach, new.error, new.reason, new.solution, new.context);
    END;
  `);
}
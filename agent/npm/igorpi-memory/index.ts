/**
 * igorpi-memory — Persistent memory extension for pi-coding-agent.
 * 
 * Предоставляет:
 * - Singleton MemoryDatabase с SQLite + FTS5
 * - SessionMemory для автоматического извлечения фактов
 * - Consolidation для слияния похожих записей
 * - Result compression
 * 
 * Публичный API:
 */

import { MemoryDatabase } from "./database.js";
import { getSessionMemory, resetSessionMemory, type SessionMemory } from "./session-memory.js";
import { consolidateMemory } from "./consolidation.js";
import { escapeFts5Query } from "./utils/fts-escape.js";
import { priorityEmoji, type Priority } from "./utils/priority.js";
import { registerMemoryCommands } from "./commands/memory-commands.js";
import { registerSessionEvents } from "./commands/session-events.js";

// ============================================================
// Singleton-инициализация при загрузке расширения
// ============================================================

let initialized = false;

function ensureInitialized(): MemoryDatabase {
  if (!initialized) {
    MemoryDatabase.getInstance();
    initialized = true;
  }
  return MemoryDatabase.getInstance();
}

export default function (pi: any) {
  // Инициализируем БД при старте расширения
  const db = ensureInitialized();
  const stats = db.getStats();
  console.log(
    `[igorpi-memory] 📦 Memory database initialized. ` +
    `Tool outputs: ${stats.toolOutputs}, ` +
    `Subagent results: ${stats.subagentResults}, ` +
    `Session facts: ${stats.sessionFacts}, ` +
    `Size: ${stats.dbSizeMb.toFixed(2)} MB`
  );

  // Регистрируем команды памяти
  registerMemoryCommands(pi, db);

  // Регистрируем session events (auto-purge, auto-consolidation)
  const sessionMemory = getSessionMemory(db);
  registerSessionEvents(pi, db, sessionMemory);
}

// ============================================================
// Публичный API
// ============================================================

export { MemoryDatabase, getSessionMemory, resetSessionMemory, consolidateMemory, escapeFts5Query, priorityEmoji };
export type { SessionMemory } from "./session-memory.js";
export type { ToolOutput, SaveToolOutputResult, SubagentResult, SessionFact, CompactionSummary, CompactionKeyword, FailureRecord, CompressedResult } from "./database.js";
export type { ConsolidationResult } from "./consolidation.js";
export type { CompressionResult } from "./result-compressor.js";
export type { Priority } from "./utils/priority.js";

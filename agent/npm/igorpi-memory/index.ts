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

import { registerMemoryCommands } from "./commands/memory-commands.js";
import { registerSessionEvents } from "./commands/session-events.js";
import { consolidateMemory } from "./consolidation.js";
import { MemoryDatabase } from "./database.js";
import { getSessionMemory, resetSessionMemory } from "./session-memory.js";
import { escapeFts5Query } from "./utils/fts-escape.js";
import { priorityEmoji } from "./utils/priority.js";

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
			`Size: ${stats.dbSizeMb.toFixed(2)} MB`,
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

export type { ConsolidationResult } from "./consolidation.js";
export type {
	CodeDependency,
	CodeDiagnostic,
	CodeDuplicate,
	CompactionKeyword,
	CompactionSummary,
	CompressedResult,
	FailureRecord,
	SaveToolOutputResult,
	SessionFact,
	SubagentResult,
	ToolOutput,
	UnusedCode,
} from "./database.js";
export type { CompressionResult } from "./result-compressor.js";
export type { SessionMemory } from "./session-memory.js";
export type { Priority } from "./utils/priority.js";
export {
	consolidateMemory,
	escapeFts5Query,
	getSessionMemory,
	MemoryDatabase,
	priorityEmoji,
resetSessionMemory,
};

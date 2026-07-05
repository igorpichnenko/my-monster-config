/**
 * database.ts — Фасад для работы с БД памяти.
 * 
 * Делегирует операции репозиториям, сохраняя старый API
 * для обратной совместимости.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { initSchema } from "./schema.js";
import {
  ToolOutputsRepository,
  SubagentResultsRepository,
  SessionFactsRepository,
  CompactionRepository,
  FailuresRepository,
  CompressedResultsRepository,
} from "./repositories/index.js";

/** Путь к БД относительно корня проекта. */
const DB_RELATIVE_PATH = ".pi/memory/unified.db";

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

  // Репозитории
  public readonly toolOutputs: ToolOutputsRepository;
  public readonly subagentResults: SubagentResultsRepository;
  public readonly sessionFacts: SessionFactsRepository;
  public readonly compaction: CompactionRepository;
  public readonly failures: FailuresRepository;
  public readonly compressedResults: CompressedResultsRepository;

  private constructor(dbFilePath: string) {
    const dir = dirname(dbFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -64000");

    // Инициализация схемы
    initSchema(this.db);

    // Инициализация репозиториев
    this.toolOutputs = new ToolOutputsRepository(this.db);
    this.subagentResults = new SubagentResultsRepository(this.db);
    this.sessionFacts = new SessionFactsRepository(this.db);
    this.compaction = new CompactionRepository(this.db);
    this.failures = new FailuresRepository(this.db);
    this.compressedResults = new CompressedResultsRepository(this.db);
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

  getRaw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  // =========================================================================
  // Backward-compatible API (делегирование репозиториям)
  // =========================================================================

  // Tool Outputs
  saveToolOutput(data: Parameters<ToolOutputsRepository["save"]>[0]) {
    return this.toolOutputs.save(data);
  }

  getToolOutput(id: number) {
    return this.toolOutputs.getById(id);
  }

  searchToolOutputs(query: string, limit: number = 10) {
    return this.toolOutputs.search(query, limit);
  }

  getRecentToolOutputs(limit: number = 10) {
    return this.toolOutputs.getRecent(limit);
  }

  purgeOldToolOutputs(daysOld: number = 7) {
    return this.toolOutputs.purgeOld(daysOld);
  }

  // Subagent Results
  saveSubagentResult(data: Parameters<SubagentResultsRepository["save"]>[0]) {
    return this.subagentResults.save(data);
  }

  getSubagentResult(id: string) {
    return this.subagentResults.getById(id);
  }

  searchSubagentResults(query: string, limit: number = 10) {
    return this.subagentResults.search(query, limit);
  }

  // Session Facts
  saveFact(data: Parameters<SessionFactsRepository["save"]>[0]) {
    return this.sessionFacts.save(data);
  }

  getFactById(id: number) {
    return this.sessionFacts.getById(id);
  }

  searchFacts(query: string, limit: number = 10) {
    return this.sessionFacts.search(query, limit);
  }

  searchFactsLike(pattern: string, limit: number = 10) {
    return this.sessionFacts.searchLike(pattern, limit);
  }

  getRecentFacts(limit: number = 20) {
    return this.sessionFacts.getRecent(limit);
  }

  purgeOldFacts(daysOld: number = 30) {
    return this.sessionFacts.purgeOld(daysOld);
  }

  updateFactContent(id: number, content: string) {
    return this.sessionFacts.updateContent(id, content);
  }

  deleteFact(id: number) {
    return this.sessionFacts.delete(id);
  }

  // Compressed Results
  getCompressedResult(originalHash: string) {
    return this.compressedResults.getByHash(originalHash);
  }

  saveCompressedResult(originalHash: string, compressed: string) {
    return this.compressedResults.save(originalHash, compressed);
  }

  getCompressedResultById(id: number) {
    return this.compressedResults.getById(id);
  }

  searchCompressedResults(query: string, limit: number = 10) {
    return this.compressedResults.search(query, limit);
  }

  purgeOldCompressedResults(daysOld: number = 30) {
    return this.compressedResults.purgeOld(daysOld);
  }

  // Compaction
  saveCompactionSummary(data: Parameters<CompactionRepository["saveSummary"]>[0]) {
    return this.compaction.saveSummary(data);
  }

  getCompactionSummaryById(id: number) {
    return this.compaction.getSummaryById(id);
  }

  getCompactionSummaries(sessionId: string, limit: number = 10) {
    return this.compaction.getSummaries(sessionId, limit);
  }

  searchCompactionSummaries(query: string, limit: number = 10) {
    return this.compaction.searchSummaries(query, limit);
  }

  purgeOldCompactionSummaries(daysOld: number = 30) {
    return this.compaction.purgeOldSummaries(daysOld);
  }

  saveCompactionKeyword(data: Parameters<CompactionRepository["saveKeyword"]>[0]) {
    return this.compaction.saveKeyword(data);
  }

  saveCompactionKeywords(keywords: Parameters<CompactionRepository["saveKeywords"]>[0]) {
    return this.compaction.saveKeywords(keywords);
  }

  getCompactionKeywords(compactionId: number) {
    return this.compaction.getKeywords(compactionId);
  }

  searchKeywords(query: string, limit: number = 10) {
    return this.compaction.searchKeywords(query, limit);
  }

  searchKeywordsByCategory(query: string, category: "file" | "decision" | "lesson", limit: number = 10) {
    return this.compaction.searchKeywordsByCategory(query, category, limit);
  }

  getRecentKeywords(limit: number = 20) {
    return this.compaction.getRecentKeywords(limit);
  }

  purgeOldKeywords(daysOld: number = 30) {
    return this.compaction.purgeOldKeywords(daysOld);
  }

  getKeywordsStats() {
    return this.compaction.getKeywordsStats();
  }

  // Failures
  saveFailure(data: Parameters<FailuresRepository["save"]>[0]) {
    return this.failures.save(data);
  }

  getFailureById(id: number) {
    return this.failures.getById(id);
  }

  searchFailures(query: string, limit: number = 10) {
    return this.failures.search(query, limit);
  }

  getRecentFailures(limit: number = 20) {
    return this.failures.getRecent(limit);
  }

  purgeOldFailures(daysOld: number = 30) {
    return this.failures.purgeOld(daysOld);
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
    compactionKeywords: number;
    failures: number;
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

    const compactionKeywords = (this.db.prepare(
      "SELECT COUNT(*) as count FROM compaction_keywords"
    ).get() as { count: number }).count;

    const failures = (this.db.prepare(
      "SELECT COUNT(*) as count FROM failures"
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
      compactionKeywords,
      failures,
      dbSizeMb 
    };
  }
}

// Re-export types
export type { ToolOutput, SaveToolOutputResult } from "./repositories/index.js";
export type { SubagentResult } from "./repositories/index.js";
export type { SessionFact } from "./repositories/index.js";
export type { CompactionSummary, CompactionKeyword } from "./repositories/index.js";
export type { FailureRecord } from "./repositories/index.js";
export type { CompressedResult } from "./repositories/index.js";
/**
 * database.ts — Фасад для работы с БД памяти.
 * 
 * Делегирует операции репозиториям, сохраняя старый API
 * для обратной совместимости.
 * 
 * v11: Singleton адаптируется к смене проекта, автоматически пересоздаётся
 *      Добавлен getKeywordById для поиска по ID keyword
 * 
 * v14: Добавлены code analysis репозитории (diagnostics, dependencies, unused, duplicates)
 * v14.1: Добавлены методы deleteByProject для code analysis таблиц
 * v17.2: Добавлены методы deleteByFile для code analysis таблиц
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
  DiagnosticsRepository,
  DependenciesRepository,
  UnusedRepository,
  DuplicatesRepository,
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
  private static currentProjectRoot: string | null = null;

  // Репозитории
  public readonly toolOutputs: ToolOutputsRepository;
  public readonly subagentResults: SubagentResultsRepository;
  public readonly sessionFacts: SessionFactsRepository;
  public readonly compaction: CompactionRepository;
  public readonly failures: FailuresRepository;
  public readonly compressedResults: CompressedResultsRepository;
  
  // v14: Code analysis репозитории
  public readonly diagnostics: DiagnosticsRepository;
  public readonly dependencies: DependenciesRepository;
  public readonly unused: UnusedRepository;
  public readonly duplicates: DuplicatesRepository;

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
    
    // v14: Code analysis репозитории
    this.diagnostics = new DiagnosticsRepository(this.db);
    this.dependencies = new DependenciesRepository(this.db);
    this.unused = new UnusedRepository(this.db);
    this.duplicates = new DuplicatesRepository(this.db);
  }

  /**
   * Получить singleton экземпляр MemoryDatabase.
   * 
   * v11: Адаптируется к смене проекта — если projectRoot изменился,
   *      пересоздаёт singleton с новой БД.
   *      Также пересоздаёт если БД была закрыта.
   */
  static getInstance(projectDir: string = process.cwd()): MemoryDatabase {
    const projectRoot = findProjectRoot(projectDir);
    
    if (MemoryDatabase.instance) {
      // Если проект изменился — пересоздаём
      if (MemoryDatabase.currentProjectRoot !== projectRoot) {
        console.log(
          `[igorpi-memory] 🔄 Project changed: ${MemoryDatabase.currentProjectRoot} → ${projectRoot}`
        );
        MemoryDatabase.resetInstance();
      } else {
        // Проверяем что БД открыта
        try {
          MemoryDatabase.instance.db.prepare("SELECT 1").get();
        } catch {
          console.log(`[igorpi-memory] 🔄 Memory database was closed, reinitializing...`);
          MemoryDatabase.resetInstance();
        }
      }
    }
    
    if (!MemoryDatabase.instance) {
      const dbPath = join(projectRoot, DB_RELATIVE_PATH);
      MemoryDatabase.instance = new MemoryDatabase(dbPath);
      MemoryDatabase.currentProjectRoot = projectRoot;
      console.log(`[igorpi-memory] 📦 Memory database initialized at ${dbPath}`);
    }
    return MemoryDatabase.instance;
  }

  static getInstanceWithPath(dbFilePath: string): MemoryDatabase {
    if (!MemoryDatabase.instance) {
      MemoryDatabase.instance = new MemoryDatabase(dbFilePath);
      MemoryDatabase.currentProjectRoot = dirname(dirname(dbFilePath));
    }
    return MemoryDatabase.instance;
  }

  /**
   * Сбросить singleton и закрыть БД.
   * Вызывается при session_shutdown или смене проекта.
   */
  static resetInstance(): void {
    if (MemoryDatabase.instance) {
      try {
        MemoryDatabase.instance.close();
      } catch (err) {
        // Игнорируем ошибки при закрытии (БД может быть уже закрыта)
      }
      MemoryDatabase.instance = null;
      MemoryDatabase.currentProjectRoot = null;
    }
  }

  /**
   * Получить текущий путь к проекту.
   */
  static getCurrentProjectRoot(): string | null {
    return MemoryDatabase.currentProjectRoot;
  }

  /**
   * Проверить, инициализирована ли БД.
   * Используется для проверки доступности igorpi-memory.
   */
  static isInitialized(): boolean {
    return MemoryDatabase.instance !== null;
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

  /**
   * Удаляет дубликаты для одного и того же file_path.
   * Оставляет только запись с последним timestamp.
   */
  deduplicateToolOutputsByFilePath(): number {
    return this.toolOutputs.deduplicateByFilePath();
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

  searchFacts(query: string, limit: number = 10, projectPath?: string | null) {
    return this.sessionFacts.search(query, limit, projectPath);
  }

  searchFactsLike(pattern: string, limit: number = 10, projectPath?: string | null) {
    return this.sessionFacts.searchLike(pattern, limit, projectPath);
  }

  getRecentFacts(limit: number = 20, projectPath?: string | null) {
    return this.sessionFacts.getRecent(limit, projectPath);
  }

  getFactsByProject(projectPath: string, limit: number = 10000) {
    return this.sessionFacts.getByProject(projectPath, limit);
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

  /**
   * v11: Получить keyword по его ID (первичный ключ).
   * Используется в ctx-search.ts для поиска по id:<keyword_id>.
   */
  getKeywordById(id: number) {
    return this.compaction.getKeywordById(id);
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
  // v14: Code Analysis — делегирование репозиториям
  // =========================================================================

  // Diagnostics
  saveDiagnostic(data: Parameters<DiagnosticsRepository["save"]>[0]) {
    return this.diagnostics.save(data);
  }

  getDiagnosticById(id: number) {
    return this.diagnostics.getById(id);
  }

  getDiagnosticsByProject(projectPath: string, limit: number = 100) {
    return this.diagnostics.getByProject(projectPath, limit);
  }

  getDiagnosticsByFile(projectPath: string, filePath: string) {
    return this.diagnostics.getByFile(projectPath, filePath);
  }

  getDiagnosticsBySeverity(
    projectPath: string, 
    severity: 'error' | 'warning' | 'info' | 'hint', 
    limit: number = 50
  ) {
    return this.diagnostics.getBySeverity(projectPath, severity, limit);
  }

  searchDiagnostics(query: string, projectPath: string, limit: number = 10) {
    return this.diagnostics.search(query, projectPath, limit);
  }

  deleteDiagnosticsByFile(projectPath: string, filePath: string) {
    return this.diagnostics.deleteByFile(projectPath, filePath);
  }

  /** v14.1: Удаляет все диагностики для проекта */
  deleteDiagnosticsByProject(projectPath: string): number {
    return this.diagnostics.deleteByProject(projectPath);
  }

  purgeOldDiagnostics(daysOld: number = 30) {
    return this.diagnostics.purgeOld(daysOld);
  }

  getDiagnosticsStats(projectPath: string) {
    return this.diagnostics.getStats(projectPath);
  }

  // Dependencies
  saveDependency(data: Parameters<DependenciesRepository["save"]>[0]) {
    return this.dependencies.save(data);
  }

  getDependenciesByProject(projectPath: string, limit: number = 1000) {
    return this.dependencies.getByProject(projectPath, limit);
  }

  getDependenciesForFile(projectPath: string, filePath: string) {
    return this.dependencies.getDependenciesForFile(projectPath, filePath);
  }

  getDependentsOf(projectPath: string, filePath: string) {
    return this.dependencies.getDependentsOf(projectPath, filePath);
  }

  getCircularDependencies(projectPath: string) {
    return this.dependencies.getCircularDependencies(projectPath);
  }

  searchDependencies(query: string, projectPath: string, limit: number = 10) {
    return this.dependencies.search(query, projectPath, limit);
  }

  /** v14.1: Удаляет все зависимости для проекта */
  deleteDependenciesByProject(projectPath: string): number {
    return this.dependencies.deleteByProject(projectPath);
  }

  /** v17.2: Удаляет зависимости для конкретного файла */
  deleteDependenciesByFile(projectPath: string, filePath: string): number {
    return this.dependencies.deleteByFile(projectPath, filePath);
  }

  purgeOldDependencies(daysOld: number = 30) {
    return this.dependencies.purgeOld(daysOld);
  }

  // Unused Code
  saveUnusedCode(data: Parameters<UnusedRepository["save"]>[0]) {
    return this.unused.save(data);
  }

  getUnusedByProject(projectPath: string, limit: number = 100) {
    return this.unused.getByProject(projectPath, limit);
  }

  getUnusedByFile(projectPath: string, filePath: string) {
    return this.unused.getByFile(projectPath, filePath);
  }

  getUnusedByType(projectPath: string, symbolType: string, limit: number = 50) {
    return this.unused.getByType(projectPath, symbolType, limit);
  }

  searchUnused(query: string, projectPath: string, limit: number = 10) {
    return this.unused.search(query, projectPath, limit);
  }

  /** v14.1: Удаляет все записи unused для проекта */
  deleteUnusedByProject(projectPath: string): number {
    return this.unused.deleteByProject(projectPath);
  }

  purgeOldUnused(daysOld: number = 30) {
    return this.unused.purgeOld(daysOld);
  }

  // Duplicates
  saveDuplicate(data: Parameters<DuplicatesRepository["save"]>[0]) {
    return this.duplicates.save(data);
  }

  getDuplicatesByProject(projectPath: string, limit: number = 100) {
    return this.duplicates.getByProject(projectPath, limit);
  }

  getDuplicatesByFile(projectPath: string, filePath: string) {
    return this.duplicates.getByFile(projectPath, filePath);
  }

  getHighSimilarityDuplicates(
    projectPath: string, 
    minSimilarity: number = 0.8, 
    limit: number = 50
  ) {
    return this.duplicates.getHighSimilarity(projectPath, minSimilarity, limit);
  }

  searchDuplicates(query: string, projectPath: string, limit: number = 10) {
    return this.duplicates.search(query, projectPath, limit);
  }

  /** v14.1: Удаляет все дубликаты для проекта */
  deleteDuplicatesByProject(projectPath: string): number {
    return this.duplicates.deleteByProject(projectPath);
  }

  purgeOldDuplicates(daysOld: number = 30) {
    return this.duplicates.purgeOld(daysOld);
  }

  // =========================================================================
  // Вспомогательная функция — безопасный COUNT
  // =========================================================================

  private countTable(table: string): number {
    try {
      return (this.db.prepare(
        `SELECT COUNT(*) as count FROM ${table}`
      ).get() as { count: number }).count;
    } catch {
      return 0; // таблица не существует
    }
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
    codeDiagnostics: number;
    codeDependencies: number;
    unusedCode: number;
    codeDuplicates: number;
    dbSizeMb: number;
  } {
    const toolOutputs = this.countTable("tool_outputs");
    const subagentResults = this.countTable("subagent_results");
    const sessionFacts = this.countTable("session_facts");
    const compressedResults = this.countTable("compressed_results");
    const compactionSummaries = this.countTable("compaction_summaries");
    const compactionKeywords = this.countTable("compaction_keywords");
    const failures = this.countTable("failures");
    
    // v14: Code analysis tables
    const codeDiagnostics = this.countTable("code_diagnostics");
    const codeDependencies = this.countTable("code_dependencies");
    const unusedCode = this.countTable("unused_code");
    const codeDuplicates = this.countTable("code_duplicates");

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
      codeDiagnostics,
      codeDependencies,
      unusedCode,
      codeDuplicates,
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

// v14: Code analysis types
export type { CodeDiagnostic } from "./repositories/index.js";
export type { CodeDependency } from "./repositories/index.js";
export type { UnusedCode } from "./repositories/index.js";
export type { CodeDuplicate } from "./repositories/index.js";
/**
 * repositories/index.ts — Экспорты всех репозиториев.
 */

export { ToolOutputsRepository, type ToolOutput, type SaveToolOutputResult } from "./tool-outputs.repository.js";
export { SubagentResultsRepository, type SubagentResult } from "./subagent-results.repository.js";
export { SessionFactsRepository, type SessionFact } from "./session-facts.repository.js";
export { CompactionRepository, type CompactionSummary, type CompactionKeyword } from "./compaction.repository.js";
export { FailuresRepository, type FailureRecord } from "./failures.repository.js";
export { CompressedResultsRepository, type CompressedResult } from "./compressed-results.repository.js";

export { DiagnosticsRepository } from "./diagnostics.repository.js";
export type { CodeDiagnostic } from "./diagnostics.repository.js";

export { DependenciesRepository } from "./dependencies.repository.js";
export type { CodeDependency } from "./dependencies.repository.js";

export { UnusedRepository } from "./unused.repository.js";
export type { UnusedCode } from "./unused.repository.js";

export { DuplicatesRepository } from "./duplicates.repository.js";
export type { CodeDuplicate } from "./duplicates.repository.js";
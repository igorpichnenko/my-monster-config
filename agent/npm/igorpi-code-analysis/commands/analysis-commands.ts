/**
 * analysis-commands.ts — Команды для анализа кода
 * 
 * v18.3: Возвращена команда /agent-errors + прогресс + таймаут 3 минуты
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryDatabase } from "../../igorpi-memory/index.js";
import { getTypeScriptAnalyzer } from "../analyzers/typescript-analyzer.js";
import { getPythonAnalyzer } from "../analyzers/python-analyzer.js";
import { getCppAnalyzer } from "../analyzers/cpp-analyzer.js";
import { detectProjectType, isSupportedFile } from "../analyzers/project-detector.js";
import { log } from "../lib/logger.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function isRealError(d: any) {
  const s = typeof d.severity === "string" ? d.severity.toLowerCase() : d.severity;
  return s === "error" || s === 1;
}
function isWarning(d: any) {
  const s = typeof d.severity === "string" ? d.severity.toLowerCase() : d.severity;
  return s === "warning" || s === 2;
}
function isHint(d: any) {
  const s = typeof d.severity === "string" ? d.severity.toLowerCase() : d.severity;
  return s === "hint" || s === "information" || s === 3 || s === 4;
}
function isSignificant(d: any) {
  return isRealError(d) || isWarning(d);
}

export function registerAnalysisCommands(pi: ExtensionAPI, memoryDb: MemoryDatabase): void {
  const projectPath = process.cwd();
  const projectType = detectProjectType(projectPath);
  log(`📋 Registering commands for ${projectType} project`);

  // /analyze <file>
  pi.registerCommand("analyze", {
    description: "Analyze a file for errors: /analyze <file>",
    handler: async (argStr: string, cmdCtx: any) => {
      const filePath = argStr.trim();
      if (!filePath) return cmdCtx.ui.notify("Usage: /analyze <file>", "warning");
      if (!isSupportedFile(filePath)) return cmdCtx.ui.notify(`File type not supported: ${filePath}`, "warning");

      cmdCtx.ui.notify(`🔍 Analyzing ${filePath}...`, "info");

      try {
        let analyzer: any = null;
        if (projectType === "typescript") analyzer = getTypeScriptAnalyzer(projectPath);
        else if (projectType === "python") analyzer = getPythonAnalyzer(projectPath);
        else if (projectType === "cpp") analyzer = getCppAnalyzer(projectPath);

        if (!analyzer) return cmdCtx.ui.notify(`Analysis not implemented for ${projectType} projects yet`, "warning");
        if (!analyzer.isInitialized()) await analyzer.initialize();

        const diagnostics = await analyzer.analyzeFile(filePath);
        const significant = diagnostics.filter(isSignificant);

        if (significant.length === 0) {
          memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
          return cmdCtx.ui.notify(`✅ No errors found in ${filePath}`, "info");
        }

        const lines = [`🔍 Found ${significant.length} error(s) in ${filePath}:`, ""];
        for (const diag of significant.slice(0, 20)) {
          const icon = isRealError(diag) ? "❌" : "⚠️";
          lines.push(`${icon} ${diag.filePath}:${diag.line}:${diag.column}`, `   ${diag.message}`);
          if (diag.ruleId) lines.push(`   Rule: ${diag.ruleId}`);
          lines.push("");
        }
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze ${filePath}: ${err}`, "error");
      }
    },
  });

  // /errors [file]
  pi.registerCommand("errors", {
    description: "Show errors from database: /errors [file]",
    handler: async (argStr: string, cmdCtx: any) => {
      const filePath = argStr.trim();
      try {
        const errors = filePath ? memoryDb.getDiagnosticsByFile(projectPath, filePath) : memoryDb.getDiagnosticsByProject(projectPath, 50);
        if (errors.length === 0) {
          if (filePath) memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
          else memoryDb.deleteDiagnosticsByProject(projectPath);
          return cmdCtx.ui.notify("✅ No errors found (DB cleared)", "info");
        }

        const lines = [`🔍 Found ${errors.length} error(s):`, ""];
        for (const err of errors.slice(0, 20)) {
          const icon = err.severity === "error" ? "❌" : "⚠️";
          lines.push(`${icon} ${err.file_path}:${err.line}:${err.column}`, `   ${err.message}`);
          if (err.rule_id) lines.push(`   Rule: ${err.rule_id}`);
          lines.push("");
        }
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to get errors: ${err}`, "error");
      }
    },
  });

  // /fix <file>
  pi.registerCommand("fix", {
    description: "Auto-fix errors in file: /fix <file>",
    handler: async (argStr: string, cmdCtx: any) => {
      const filePath = argStr.trim();
      if (!filePath) return cmdCtx.ui.notify("Usage: /fix <file>", "warning");
      cmdCtx.ui.notify(`🔧 Auto-fixing ${filePath}...`, "info");

      try {
        const { AutoFixer } = await import("../auto-fix/auto-fixer.js");
        const autoFixer = new AutoFixer(projectPath);
        const result = await autoFixer.fixFile(filePath);

        if (result.fixed) {
          let analyzer: any = null;
          if (projectType === "typescript") analyzer = getTypeScriptAnalyzer(projectPath);
          else if (projectType === "python") analyzer = getPythonAnalyzer(projectPath);
          else if (projectType === "cpp") analyzer = getCppAnalyzer(projectPath);

          if (analyzer) {
            if (!analyzer.isInitialized()) await analyzer.initialize();
            const diagnostics = await analyzer.analyzeFile(filePath);
            const significant = diagnostics.filter(isSignificant);

            if (significant.length === 0) {
              memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
              cmdCtx.ui.notify(`${result.message}\n✅ All errors fixed, DB cleared`, "info");
            } else {
              cmdCtx.ui.notify(`${result.message}\n⚠️ ${significant.length} error(s) remain`, "warning");
            }
          }
        } else {
          cmdCtx.ui.notify(result.message, result.fixed ? "info" : "warning");
        }
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to auto-fix: ${err}`, "error");
      }
    },
  });

  // /impact <file> [depth]
  pi.registerCommand("impact", {
    description: "Show impacted files: /impact <file> [depth>",
    handler: async (argStr: string, cmdCtx: any) => {
      const parts = argStr.trim().split(/\s+/);
      const filePath = parts[0];
      const depth = parseInt(parts[1]) || 3;
      if (!filePath) return cmdCtx.ui.notify("Usage: /impact <file> [depth]", "warning");

      cmdCtx.ui.notify(`🔍 Analyzing impact of ${filePath}...`, "info");
      try {
        const { DependencyAnalyzer } = await import("../impact/dependency-analyzer.js");
        const analyzer = new DependencyAnalyzer(projectPath, memoryDb);
        await analyzer.analyzeProject();
        const result = analyzer.getImpact(filePath, depth);

        if (result.impactedFiles.length === 0) return cmdCtx.ui.notify(`✅ No files depend on ${filePath}`, "info");

        const lines = [`🔍 Impact analysis for ${filePath}:`, ``, `Found ${result.impactedFiles.length} impacted file(s):`, ``];
        for (const file of result.impactedFiles.slice(0, 20)) lines.push(`  📄 ${file.replace(projectPath + "/", "")}`);
        if (result.impactedFiles.length > 20) lines.push(`  ... and ${result.impactedFiles.length - 20} more`);

        if (result.circularDependencies.length > 0) {
          lines.push(``, `⚠️ Circular dependencies detected:`);
          for (const circ of result.circularDependencies) lines.push(`  🔄 ${circ}`);
        }
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze impact: ${err}`, "error");
      }
    },
  });

  // /deps [file]
  pi.registerCommand("deps", {
    description: "Show dependencies: /deps [file]",
    handler: async (argStr: string, cmdCtx: any) => {
      const filePath = argStr.trim();
      cmdCtx.ui.notify(`🔍 Analyzing dependencies...`, "info");
      try {
        const { DependencyAnalyzer } = await import("../impact/dependency-analyzer.js");
        const analyzer = new DependencyAnalyzer(projectPath, memoryDb);
        await analyzer.analyzeProject();

        if (filePath) {
          const deps = analyzer.getDependencies(filePath);
          const dependents = analyzer.getDependents(filePath);
          const lines = [`🔍 Dependencies for ${filePath}:`, ``];
          if (deps.length > 0) {
            lines.push(`📦 Depends on (${deps.length}):`);
            for (const dep of deps.slice(0, 10)) lines.push(`  → ${dep.replace(projectPath + "/", "")}`);
          } else lines.push(`📦 No dependencies`);
          lines.push(``);
          if (dependents.length > 0) {
            lines.push(`👥 Depended by (${dependents.length}):`);
            for (const dep of dependents.slice(0, 10)) lines.push(`  ← ${dep.replace(projectPath + "/", "")}`);
          } else lines.push(`👥 No dependents`);
          cmdCtx.ui.notify(lines.join("\n"), "info");
        } else {
          const allDeps = memoryDb.getDependenciesByProject(projectPath, 1000);
          const circularDeps = analyzer.detectCircularDependencies();
          const lines = [`🔍 Project dependencies:`, ``, `Total dependencies: ${allDeps.length}`, `Circular dependencies: ${circularDeps.length}`, ``];
          if (circularDeps.length > 0) {
            lines.push(`⚠️ Circular dependencies:`);
            for (const circ of circularDeps.slice(0, 10)) lines.push(`  🔄 ${circ.replace(projectPath + "/", "")}`);
          }
          cmdCtx.ui.notify(lines.join("\n"), "info");
        }
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze dependencies: ${err}`, "error");
      }
    },
  });

  // /agent-errors <id> - ВОЗВРАЩЕНА
  pi.registerCommand("agent-errors", {
    description: "Show errors introduced by subagent: /agent-errors <id>",
    handler: async (argStr: string, cmdCtx: any) => {
      const agentId = argStr.trim();
      if (!agentId) return cmdCtx.ui.notify("Usage: /agent-errors <id>", "warning");
      try {
        const raw = memoryDb.getRaw();
        const errors = raw.prepare(`SELECT * FROM code_diagnostics WHERE session_id = ? ORDER BY timestamp DESC`).all(`subagent-${agentId}`) as any[];
        if (errors.length === 0) return cmdCtx.ui.notify(`✅ No errors found for subagent ${agentId}`, "info");

        const lines = [`🔍 Found ${errors.length} error(s) from subagent ${agentId}:`, ""];
        for (const err of errors.slice(0, 20)) {
          const icon = err.severity === "error" ? "❌" : "⚠️";
          lines.push(`${icon} ${err.file_path}:${err.line}:${err.column}`, `   ${err.message}`);
          if (err.rule_id) lines.push(`   Rule: ${err.rule_id}`);
          lines.push("");
        }
        if (errors.length > 20) lines.push(`... and ${errors.length - 20} more error(s)`);
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to get agent errors: ${err}`, "error");
      }
    },
  });

  // /unused
  pi.registerCommand("unused", {
    description: "Find unused code: /unused",
    handler: async (_argStr: string, cmdCtx: any) => {
      cmdCtx.ui.notify(`🔍 Analyzing unused code...`, "info");
      try {
        const { UnusedCodeAnalyzer } = await import("../impact/unused-code-analyzer.js");
        const analyzer = new UnusedCodeAnalyzer(projectPath, memoryDb);
        const unused = await analyzer.analyzeProject();
        if (unused.length === 0) {
          memoryDb.deleteUnusedByProject(projectPath);
          return cmdCtx.ui.notify(`✅ No unused code found (DB cleared)`, "info");
        }
        const lines = [`🔍 Found ${unused.length} unused symbol(s):`, ``];
        for (const u of unused.slice(0, 20)) {
          lines.push(`🗑️ ${u.symbolType}: ${u.symbolName}`, `   ${u.filePath.replace(projectPath + "/", "")}:${u.line}`, `   Confidence: ${Math.round(u.confidence * 100)}%`, ``);
        }
        if (unused.length > 20) lines.push(`... and ${unused.length - 20} more`);
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze unused code: ${err}`, "error");
      }
    },
  });

  // /duplicates
  pi.registerCommand("duplicates", {
    description: "Find code duplicates: /duplicates",
    handler: async (_argStr: string, cmdCtx: any) => {
      cmdCtx.ui.notify(`🔍 Analyzing code duplicates...`, "info");
      try {
        const { CodeDuplicatesAnalyzer } = await import("../impact/code-duplicates-analyzer.js");
        const analyzer = new CodeDuplicatesAnalyzer(projectPath, memoryDb);
        const duplicates = await analyzer.analyzeProject();
        if (duplicates.length === 0) {
          memoryDb.deleteDuplicatesByProject(projectPath);
          return cmdCtx.ui.notify(`✅ No code duplicates found (DB cleared)`, "info");
        }
        const lines = [`🔍 Found ${duplicates.length} duplicate block(s):`, ``];
        for (const dup of duplicates.slice(0, 10)) {
          lines.push(`📋 Duplicate (${Math.round(dup.similarity * 100)}% similar, ${dup.linesCount} lines):`, `   ${dup.filePath1.replace(projectPath + "/", "")}:${dup.lineStart1}-${dup.lineEnd1}`, `   ${dup.filePath2.replace(projectPath + "/", "")}:${dup.lineStart2}-${dup.lineEnd2}`, ``);
        }
        if (duplicates.length > 10) lines.push(`... and ${duplicates.length - 10} more`);
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze duplicates: ${err}`, "error");
      }
    },
  });

  // /analyze-project [--full]
  pi.registerCommand("analyze-project", {
    description: "Quick project analysis: /analyze-project [--full]",
    handler: async (argStr: string, cmdCtx: any) => {
      const fullMode = argStr.trim() === "--full";
      cmdCtx.ui.notify(`🔍 Starting ${fullMode ? "FULL" : "quick"} project analysis...`, "info");

      const startTime = Date.now();
      const results: string[] = [];

      try {
        cmdCtx.ui.notify(`📊 Analyzing dependencies...`, "info");
        const { DependencyAnalyzer } = await import("../impact/dependency-analyzer.js");
        const depAnalyzer = new DependencyAnalyzer(projectPath, memoryDb);
        await depAnalyzer.analyzeProject();
        const deps = memoryDb.getDependenciesByProject(projectPath, 1000);
        const circularDeps = depAnalyzer.detectCircularDependencies();
        results.push(`📊 Dependencies: ${deps.length} total, ${circularDeps.length} circular`);

        cmdCtx.ui.notify(`❌ Checking errors from DB...`, "info");
        const errorsFromDb = memoryDb.getDiagnosticsByProject(projectPath, 1000);
        results.push(`❌ Errors (from DB): ${errorsFromDb.length} total`);

        if (fullMode) {
          cmdCtx.ui.notify(`🔬 Full mode: checking all files with LSP...`, "info");
          const files = getAllFiles(projectPath);
          let totalErrors = 0, totalWarnings = 0, totalHints = 0, filesWithErrors = 0;

          memoryDb.deleteDiagnosticsByProject(projectPath);

          let analyzer: any = null;
          if (projectType === "typescript") analyzer = getTypeScriptAnalyzer(projectPath);
          else if (projectType === "python") analyzer = getPythonAnalyzer(projectPath);
          else if (projectType === "cpp") analyzer = getCppAnalyzer(projectPath);

          if (analyzer) {
            if (!analyzer.isInitialized()) await analyzer.initialize();

            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const progress = Math.round(((i + 1) / files.length) * 100);
              
              // Показываем прогресс каждые 5 файлов или в начале/конце
              if (i === 0 || i === files.length - 1 || (i + 1) % 5 === 0) {
                cmdCtx.ui.notify(`📊 Progress: ${i + 1}/${files.length} files (${progress}%)`, "info");
              }
              
              const diagnostics = await analyzer.analyzeFile(file, undefined, 180000);
              const errors = diagnostics.filter(isRealError);
              const warnings = diagnostics.filter(isWarning);
              const hints = diagnostics.filter(isHint);
              
              totalHints += hints.length;

              if (errors.length > 0 || warnings.length > 0) {
                filesWithErrors++;
                totalErrors += errors.length;
                totalWarnings += warnings.length;
                
                for (const diag of [...errors, ...warnings]) {
                  memoryDb.saveDiagnostic({
                    projectPath, filePath: diag.filePath, line: diag.line, column: diag.column,
                    endLine: diag.endLine, endColumn: diag.endColumn,
                    severity: isRealError(diag) ? "error" : "warning",
                    source: diag.source, ruleId: diag.ruleId, message: diag.message, suggestion: diag.suggestion,
                    sessionId: "current",
                  });
                }
              }
            }
          }

          if (totalErrors === 0 && totalWarnings === 0) {
            results.push(`🔬 LSP check: ✅ No errors (DB cleared, checked ${files.length} files, ${totalHints} hints ignored)`);
          } else {
            results.push(`🔬 LSP check: ❌ ${totalErrors} error(s), ⚠️ ${totalWarnings} warning(s) in ${filesWithErrors} file(s) (checked ${files.length} files, ${totalHints} hints ignored)`);
          }
        }

        const duration = Date.now() - startTime;
        const lines = [
          `🔍 Project Analysis Complete (${duration}ms)`, ``,
          `📁 Project: ${projectPath}`, `🏷️ Type: ${projectType}`,
          `🔧 Mode: ${fullMode ? "FULL (with LSP)" : "QUICK (DB only)"}`, ``,
          ...results, ``,
          `💡 Use /deps, /errors for details`,
          `💡 Use /unused to find unused code`,
          `💡 Use /duplicates to find code duplicates`,
          fullMode ? `` : `💡 Use /analyze-project --full for complete LSP check`,
        ];
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Failed to analyze project: ${err}`, "error");
      }
    },
  });
}

function getAllFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", "dist", "build", ".git", ".pi"].includes(entry)) continue;
      getAllFiles(fullPath, files);
    } else {
      if (/\.(ts|tsx|js|jsx|py|pyi|cpp|c|h|hpp)$/.test(entry)) files.push(fullPath);
    }
  }
  return files;
}
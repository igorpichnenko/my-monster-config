/**
 * igorpi-code-analysis — Анализ кода для pi-coding-agent
 * 
 * v20.1: Жесткая фильтрация hints + защита от спама
 * - Hints (severity 3/4) полностью игнорируются
 * - Уведомления и errorState срабатывают ТОЛЬКО на реальные errors/warnings
 */

import type { ExtensionAPI, ToolResultEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryDatabase } from "../igorpi-memory/index.js";
import { detectProjectType, isSupportedFile } from "./analyzers/project-detector.js";
import { getTypeScriptAnalyzer, resetTypeScriptAnalyzer } from "./analyzers/typescript-analyzer.js";
import { getPythonAnalyzer, resetPythonAnalyzer } from "./analyzers/python-analyzer.js";
import { getCppAnalyzer, resetCppAnalyzer } from "./analyzers/cpp-analyzer.js";
import { errorState } from "./state/error-state.js";
import { registerAnalysisCommands } from "./commands/analysis-commands.js";
import { AutoFixer } from "./auto-fix/auto-fixer.js";
import { getTreeSitterCache } from "./impact/tree-sitter-cache.js";
import { isAbsolute, join } from "node:path";
import { log } from "./lib/logger.js";

// ==========================================================================
// Хелперы для надежного определения severity (LSP может возвращать числа 1-4)
// ==========================================================================
function isRealError(d: any) {
  const s = typeof d.severity === "string" ? d.severity.toLowerCase() : d.severity;
  return s === "error" || s === 1;
}
function isWarning(d: any) {
  const s = typeof d.severity === "string" ? d.severity.toLowerCase() : d.severity;
  return s === "warning" || s === 2;
}
function isSignificant(d: any) {
  return isRealError(d) || isWarning(d);
}

export default function (pi: ExtensionAPI) {
  const memoryDb = MemoryDatabase.getInstance();
  const projectPath = process.cwd();
  const projectType = detectProjectType(projectPath);

  log(`✅ Extension initialized`);
  log(`📁 Project path: ${projectPath}`);
  log(`🏷️ Project type: ${projectType}`);

  registerAnalysisCommands(pi, memoryDb);

  pi.registerMessageRenderer("igorpi-code-analysis", (message, _opts, theme) => {
    const { Text } = require("@earendil-works/pi-tui");
    return new Text(theme.fg("warning", String(message.content)), 0, 0);
  });

  if (projectType === "typescript") {
    const analyzer = getTypeScriptAnalyzer(projectPath);
    analyzer.initialize().then(() => log(`✅ TypeScript analyzer ready`)).catch((err) => log(`❌ Failed to initialize TypeScript analyzer: ${err}`));
  } else if (projectType === "python") {
    const analyzer = getPythonAnalyzer(projectPath);
    analyzer.initialize().then(() => log(`✅ Python analyzer ready`)).catch((err) => log(`❌ Failed to initialize Python analyzer: ${err}`));
  } else if (projectType === "cpp") {
    const analyzer = getCppAnalyzer(projectPath);
    analyzer.initialize().then(() => log(`✅ C++ analyzer ready`)).catch((err) => log(`❌ Failed to initialize C++ analyzer: ${err}`));
  } else {
    log(`⚠️ Unknown project type — analysis disabled`);
  }

  // ==========================================================================
  // Подписка на события от субагентов
  // ==========================================================================
  pi.events.on("subagents:file_edited", async (event: any) => {
    const { agentId, agentType, toolName, filePath, cwd } = event;
    
    log(`🔔 Subagent ${agentId} (${agentType}) edited: ${filePath} via ${toolName}`);
    
    if (!isSupportedFile(filePath)) {
      log(`⏭️ Skipping subagent edit — unsupported file type`);
      return;
    }
    
    const subagentProjectType = detectProjectType(cwd);
    log(`🏷️ Subagent project type: ${subagentProjectType}`);
    
    try {
      let diagnostics: any[] = [];
      
      if (subagentProjectType === "typescript") {
        const analyzer = getTypeScriptAnalyzer(cwd);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        const { readFileSync } = await import("node:fs");
        diagnostics = await analyzer.updateFile(filePath, readFileSync(filePath, "utf-8"));
      } else if (subagentProjectType === "python") {
        const analyzer = getPythonAnalyzer(cwd);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        const { readFileSync } = await import("node:fs");
        diagnostics = await analyzer.updateFile(filePath, readFileSync(filePath, "utf-8"));
      } else if (subagentProjectType === "cpp") {
        const analyzer = getCppAnalyzer(cwd);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        const { readFileSync } = await import("node:fs");
        diagnostics = await analyzer.updateFile(filePath, readFileSync(filePath, "utf-8"));
      }
      
      const significantDiagnostics = diagnostics.filter(isSignificant);
      log(`📊 Total diagnostics: ${diagnostics.length}, significant: ${significantDiagnostics.length}`);
      
      if (significantDiagnostics.length > 0) {
        log(`⚠️ Subagent ${agentId} introduced ${significantDiagnostics.length} error(s) in ${filePath}`);
        memoryDb.deleteDiagnosticsByFile(cwd, filePath);
        
        for (const diag of significantDiagnostics) {
          memoryDb.saveDiagnostic({
            projectPath: cwd, filePath: diag.filePath, line: diag.line, column: diag.column,
            endLine: diag.endLine, endColumn: diag.endColumn,
            severity: isRealError(diag) ? "error" : "warning",
            source: diag.source, ruleId: diag.ruleId, message: diag.message, suggestion: diag.suggestion,
            sessionId: `subagent-${agentId}`,
          });
        }
        
        const errorLines = [`⚠️ Subagent ${agentId} (${agentType}) introduced ${significantDiagnostics.length} error(s) in ${filePath}:`, ``];
        for (const diag of significantDiagnostics.slice(0, 5)) {
          const icon = isRealError(diag) ? "❌" : "⚠️";
          errorLines.push(`${icon} Line ${diag.line}:${diag.column}`, `   ${diag.message}`);
          if (diag.ruleId) errorLines.push(`   Rule: ${diag.ruleId}`);
          errorLines.push(``);
        }
        if (significantDiagnostics.length > 5) errorLines.push(`... and ${significantDiagnostics.length - 5} more error(s).`);
        
        pi.sendMessage({ customType: "igorpi-code-analysis", content: errorLines.join("\n"), display: true }, { triggerTurn: true, deliverAs: "steer" });
      } else {
        log(`✅ Subagent ${agentId} edit produced no significant errors in ${filePath}`);
        memoryDb.deleteDiagnosticsByFile(cwd, filePath);
      }
    } catch (err) {
      log(`❌ Failed to analyze subagent edit: ${err}`);
    }
  });

  // ==========================================================================
  // Подписка на edit/write основного агента
  // ==========================================================================
  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    let filePath = (event.input as { path?: string }).path;
    if (!filePath || !isSupportedFile(filePath)) return;

    if (!isAbsolute(filePath)) filePath = join(projectPath, filePath);
    log(`📝 File edited: ${filePath}`);

    try {
      const cache = getTreeSitterCache();
      cache.invalidate(filePath);
      log(`🗑️ Cache invalidated for ${filePath}`);

      let diagnostics: any[] = [];
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(filePath, "utf-8");

      if (projectType === "typescript") {
        const analyzer = getTypeScriptAnalyzer(projectPath);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        diagnostics = await analyzer.updateFile(filePath, content);
      } else if (projectType === "python") {
        const analyzer = getPythonAnalyzer(projectPath);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        diagnostics = await analyzer.updateFile(filePath, content);
      } else if (projectType === "cpp") {
        const analyzer = getCppAnalyzer(projectPath);
        if (!analyzer.isInitialized()) await analyzer.initialize();
        diagnostics = await analyzer.updateFile(filePath, content);
      }

      const significantDiagnostics = diagnostics.filter(isSignificant);
      log(`📊 Total diagnostics: ${diagnostics.length}, significant: ${significantDiagnostics.length}`);

      if (significantDiagnostics.length > 0) {
        log(`⚠️ Found ${significantDiagnostics.length} significant error(s), starting auto-fix...`);
        let autoFixResult: any = null;
        try {
          const autoFixer = new AutoFixer(projectPath);
          autoFixResult = await autoFixer.fixFile(filePath);
        } catch (err) {
          autoFixResult = { fixed: false, message: `Auto-fix failed: ${err}` };
        }
        
        if (autoFixResult && autoFixResult.fixed) {
          const newContent = readFileSync(filePath, "utf-8");
          let newDiagnostics: any[] = [];
          
          if (projectType === "typescript") newDiagnostics = await getTypeScriptAnalyzer(projectPath).updateFile(filePath, newContent);
          else if (projectType === "python") newDiagnostics = await getPythonAnalyzer(projectPath).updateFile(filePath, newContent);
          else if (projectType === "cpp") newDiagnostics = await getCppAnalyzer(projectPath).updateFile(filePath, newContent);
          
          const significantNewDiagnostics = newDiagnostics.filter(isSignificant);
          
          if (significantNewDiagnostics.length > 0) {
            log(`⚠️ ${significantNewDiagnostics.length} error(s) remain after auto-fix`);
            memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
            
            const errors = significantNewDiagnostics.filter(isRealError);
            const warnings = significantNewDiagnostics.filter(isWarning);
            
            for (const diag of significantNewDiagnostics) {
              memoryDb.saveDiagnostic({
                projectPath, filePath: diag.filePath, line: diag.line, column: diag.column,
                endLine: diag.endLine, endColumn: diag.endColumn,
                severity: isRealError(diag) ? "error" : "warning",
                source: diag.source, ruleId: diag.ruleId, message: diag.message, suggestion: diag.suggestion,
                sessionId: "current",
              });
            }
            
            errorState.setFileError(filePath, errors.length, warnings.length);
            notifyAgentAboutErrors(pi, ctx, filePath, significantNewDiagnostics, "Auto-fix applied but errors remain");
          } else {
            log(`✅ All errors fixed by auto-fix`);
            memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
            errorState.clearFile(filePath);
          }
        } else {
          log(`⚠️ Auto-fix did not fix errors, saving original errors to DB`);
          saveOriginalErrorsAndNotify(memoryDb, pi, ctx, projectPath, filePath, significantDiagnostics);
        }
      } else {
        log(`✅ No significant errors in ${filePath}`);
        memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
        errorState.clearFile(filePath);
      }
    } catch (err) {
      log(`❌ Failed to analyze ${filePath}: ${err}`);
    }
  });

  // ==========================================================================
  // Уведомление на turn_end (ТОЛЬКО если есть реальные ошибки)
  // ==========================================================================
  pi.on("turn_end", async (event: any, ctx: any) => {
    // v18: Проверяем реальное количество ошибок в БД, а не errorState
    const errorsInDb = memoryDb.getDiagnosticsByProject(projectPath, 1000);
    
    if (errorsInDb.length > 0) {
      const errorCount = errorsInDb.filter(e => e.severity === "error").length;
      const warningCount = errorsInDb.filter(e => e.severity === "warning").length;
      
      if (errorCount === 0 && warningCount === 0) {
        // Нет реальных ошибок - очищаем errorState
        errorState.reset();
        return;
      }
      
      // Получаем уникальные файлы с ошибками
      const filesWithErrors = [...new Set(errorsInDb.map(e => e.file_path))].slice(0, 3);
      
      const parts: string[] = [];
      if (errorCount > 0) parts.push(`❌ ${errorCount} error(s)`);
      if (warningCount > 0) parts.push(`⚠️ ${warningCount} warning(s)`);
      
      const summary = parts.join(", ");
      
      ctx.ui.notify(
        `${summary} in ${filesWithErrors.length} file(s): ${filesWithErrors.map(f => f.split("/").slice(-2).join("/")).join(", ")}${filesWithErrors.length > 3 ? "..." : ""}. ` +
        `Use /errors to review or /fix to auto-fix.`,
        "warning"
      );
    } else {
      // БД пустая - очищаем errorState
      errorState.reset();
    }
  });

  pi.on("session_shutdown", async () => {
    log(`🛑 Session shutdown`);
    if (projectType === "typescript") { await getTypeScriptAnalyzer(projectPath).shutdown(); resetTypeScriptAnalyzer(); } 
    else if (projectType === "python") { await getPythonAnalyzer(projectPath).shutdown(); resetPythonAnalyzer(); } 
    else if (projectType === "cpp") { await getCppAnalyzer(projectPath).shutdown(); resetCppAnalyzer(); }
    errorState.reset();
  });
}

// ==========================================================================
// Вспомогательные функции
// ==========================================================================

function saveOriginalErrorsAndNotify(
  memoryDb: MemoryDatabase, pi: ExtensionAPI, ctx: ExtensionContext,
  projectPath: string, filePath: string, diagnostics: any[]
): void {
  const significant = diagnostics.filter(isSignificant);
  if (significant.length === 0) {
    memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
    errorState.clearFile(filePath);
    return;
  }

  memoryDb.deleteDiagnosticsByFile(projectPath, filePath);
  const errors = significant.filter(isRealError);
  const warnings = significant.filter(isWarning);
  
  for (const diag of significant) {
    memoryDb.saveDiagnostic({
      projectPath, filePath: diag.filePath, line: diag.line, column: diag.column,
      endLine: diag.endLine, endColumn: diag.endColumn,
      severity: isRealError(diag) ? "error" : "warning",
      source: diag.source, ruleId: diag.ruleId, message: diag.message, suggestion: diag.suggestion,
      sessionId: "current",
    });
  }
  
  errorState.setFileError(filePath, errors.length, warnings.length);
  notifyAgentAboutErrors(pi, ctx, filePath, significant, "Auto-fix failed");
}

function notifyAgentAboutErrors(
  pi: ExtensionAPI, ctx: ExtensionContext, filePath: string, diagnostics: any[], reason: string
): void {
  const significant = diagnostics.filter(isSignificant);
  if (significant.length === 0) return;

  const errorLines = [`⚠️ CODE ERRORS DETECTED in ${filePath}`, ``, `Found ${significant.length} error(s) (${reason}):`, ``];

  for (const diag of significant.slice(0, 10)) {
    const icon = isRealError(diag) ? "❌" : "⚠️";
    errorLines.push(`${icon} Line ${diag.line}:${diag.column}`, `   ${diag.message}`);
    if (diag.ruleId) errorLines.push(`   Rule: ${diag.ruleId}`);
    errorLines.push(``);
  }

  if (significant.length > 10) errorLines.push(`... and ${significant.length - 10} more error(s). Use /errors to see all.`);

  pi.sendMessage({ customType: "igorpi-code-analysis", content: errorLines.join("\n"), display: true }, { triggerTurn: true, deliverAs: "steer" });
  ctx.ui.notify(`⚠️ ${significant.length} error(s) in ${filePath}. ${reason}.`, "warning");
}
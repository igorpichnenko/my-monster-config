/**
 * igorpi-code-analysis — Анализ кода для pi-coding-agent
 * 
 * v20.3: Добавлена поддержка Go + исправлено управление errorState
 * - errorState управляется на основе БД, а не анализатора
 * - Уведомления показываются ТОЛЬКО если есть реальные ошибки в БД
 */

import type { ExtensionAPI, ToolResultEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MemoryDatabase } from "../igorpi-memory/index.js";
import { detectProjectType, isSupportedFile } from "./analyzers/project-detector.js";
import { getTypeScriptAnalyzer, resetTypeScriptAnalyzer } from "./analyzers/typescript-analyzer.js";
import { getPythonAnalyzer, resetPythonAnalyzer } from "./analyzers/python-analyzer.js";
import { getCppAnalyzer, resetCppAnalyzer } from "./analyzers/cpp-analyzer.js";
import { getGoAnalyzer, resetGoAnalyzer } from "./analyzers/go-analyzer.js";
import { errorState } from "./state/error-state.js";
import { registerAnalysisCommands } from "./commands/analysis-commands.js";
import { AutoFixer } from "./auto-fix/auto-fixer.js";
import { getTreeSitterCache } from "./impact/tree-sitter-cache.js";
import { isAbsolute, join } from "node:path";
import { log } from "./lib/logger.js";

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

/**
 * Определяет тип языка по расширению файла и возвращает соответствующий анализатор.
 * Это ключевая функция: выбор анализатора определяется расширением файла,
 * а не типом проекта. Это позволяет корректно обрабатывать проекты с несколькими языками.
 */
function getAnalyzerForFile(filePath: string, cwd: string): { analyzer: any; lang: string } | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;

  // Определяем язык по расширению файла
  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    return { analyzer: getTypeScriptAnalyzer(cwd), lang: "typescript" };
  }
  if (["py", "pyi"].includes(ext)) {
    return { analyzer: getPythonAnalyzer(cwd), lang: "python" };
  }
  if (["cpp", "c", "cc", "cxx", "h", "hpp"].includes(ext)) {
    return { analyzer: getCppAnalyzer(cwd), lang: "cpp" };
  }
  if (ext === "go") {
    return { analyzer: getGoAnalyzer(cwd), lang: "go" };
  }
  return null;
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

  // Инициализируем ВСЕ анализаторы, которые могут понадобиться.
  // Выбор анализатора для конкретного файла определяется по расширению файла,
  // а не по типу проекта. Это позволяет корректно анализировать проекты
  // с несколькими языками (например, TS + Go).
  const tsAnalyzer = getTypeScriptAnalyzer(projectPath);
  tsAnalyzer.initialize().then(() => log(`✅ TypeScript analyzer ready`)).catch((err) => log(`❌ Failed to initialize TypeScript analyzer: ${err}`));

  const pyAnalyzer = getPythonAnalyzer(projectPath);
  pyAnalyzer.initialize().then(() => log(`✅ Python analyzer ready`)).catch((err) => log(`❌ Failed to initialize Python analyzer: ${err}`));

  const cppAnalyzer = getCppAnalyzer(projectPath);
  cppAnalyzer.initialize().then(() => log(`✅ C++ analyzer ready`)).catch((err) => log(`❌ Failed to initialize C++ analyzer: ${err}`));

  const goAnalyzer = getGoAnalyzer(projectPath);
  goAnalyzer.initialize().then(() => log(`✅ Go analyzer ready`)).catch((err) => log(`❌ Failed to initialize Go analyzer: ${err}`));

  // ==========================================================================
  // Подписка на события от субагентов
  // ==========================================================================
  pi.events.on("subagents:file_edited", async (event: any) => {
    const { agentId, agentType, toolName, filePath, cwd } = event;
    
    log(`🔔 Subagent ${agentId} (${agentType}) edited: ${filePath} via ${toolName}`);
    
    // Определяем анализатор ПО расширению файла, а не по типу проекта
    const analyzerInfo = getAnalyzerForFile(filePath, cwd);
    if (!analyzerInfo) {
      log(`⏭️ Skipping subagent edit — unsupported file type: ${filePath}`);
      return;
    }
    
    const { analyzer, lang } = analyzerInfo;
    log(`🏷️ File language: ${lang} (from extension)`);
    
    try {
      let diagnostics: any[] = [];
      const { readFileSync } = await import("node:fs");
      const fileContent = readFileSync(filePath, "utf-8");
      
      if (!analyzer.isInitialized()) await analyzer.initialize();
      diagnostics = await analyzer.updateFile(filePath, fileContent);
      
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
    if (!filePath) return;

    // Определяем анализатор ПО расширению файла, а не по типу проекта
    const analyzerInfo = getAnalyzerForFile(filePath, projectPath);
    if (!analyzerInfo) {
      log(`⏭️ Skipping tool_result — unsupported file type: ${filePath}`);
      return;
    }

    if (!isAbsolute(filePath)) filePath = join(projectPath, filePath);
    log(`📝 File edited: ${filePath}`);

    try {
      const cache = getTreeSitterCache();
      cache.invalidate(filePath);
      log(`🗑️ Cache invalidated for ${filePath}`);

      let diagnostics: any[] = [];
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(filePath, "utf-8");

      const { analyzer, lang } = analyzerInfo;
      log(`🏷️ File language: ${lang} (from extension)`);

      if (!analyzer.isInitialized()) await analyzer.initialize();
      diagnostics = await analyzer.updateFile(filePath, content);

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
          
          // Определяем анализатор ПО расширению файла для повторной проверки
          const reAnalyzerInfo = getAnalyzerForFile(filePath, projectPath);
          if (reAnalyzerInfo) {
            if (!reAnalyzerInfo.analyzer.isInitialized()) await reAnalyzerInfo.analyzer.initialize();
            newDiagnostics = await reAnalyzerInfo.analyzer.updateFile(filePath, newContent);
          }
          
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
  // Уведомление на turn_end (ТОЛЬКО если есть реальные ошибки в БД)
  // ==========================================================================
  pi.on("turn_end", async (_event: any, ctx: any) => {
    const errorsInDb = memoryDb.getDiagnosticsByProject(projectPath, 1000);
    
    if (errorsInDb.length > 0) {
      const errorCount = errorsInDb.filter((e: any) => e.severity === "error").length;
      const warningCount = errorsInDb.filter((e: any) => e.severity === "warning").length;
      
      if (errorCount === 0 && warningCount === 0) {
        errorState.reset();
        return;
      }
      
      const filesWithErrors = [...new Set(errorsInDb.map((e: any) => e.file_path))].slice(0, 3);
      
      const parts: string[] = [];
      if (errorCount > 0) parts.push(`❌ ${errorCount} error(s)`);
      if (warningCount > 0) parts.push(`⚠️ ${warningCount} warning(s)`);
      
      const summary = parts.join(", ");
      
      ctx.ui.notify(
        `${summary} in ${filesWithErrors.length} file(s): ${filesWithErrors.map((f: string) => f.split("/").slice(-2).join("/")).join(", ")}${filesWithErrors.length > 3 ? "..." : ""}. ` +
        `Use /errors to review or /fix to auto-fix.`,
        "warning"
      );
    } else {
      errorState.reset();
    }
  });

  pi.on("session_shutdown", async () => {
    log(`🛑 Session shutdown`);
    // Shut down ALL analyzers — we initialize all of them now
    await getTypeScriptAnalyzer(projectPath).shutdown(); resetTypeScriptAnalyzer();
    await getPythonAnalyzer(projectPath).shutdown(); resetPythonAnalyzer();
    await getCppAnalyzer(projectPath).shutdown(); resetCppAnalyzer();
    await getGoAnalyzer(projectPath).shutdown(); resetGoAnalyzer();
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
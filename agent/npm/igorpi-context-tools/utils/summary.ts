/**
 * summary.ts — Умная генерация summary для больших выводов.
 * 
 * Использует анализаторы из analyzers.ts для создания детальных summary.
 */

import {
  analyzeFind,
  analyzeRead,
  analyzeGrep,
  analyzeBash,
  analyzeGitDiff,
  analyzeGitLog,
  analyzeGitReflog,
  analyzeGitStatus,
  analyzeNpmInstall,
  analyzeNpmTest,
  analyzeDockerLogs,
  analyzeDockerPs,
  analyzeBuild,
} from "./analyzers.js";

export function generateSummary(toolName: string, output: string, context?: any): string {
  const lines = output.split("\n");
  const nonEmptyLines = lines.filter(l => l.trim());
  const totalLines = lines.length;
  const totalChars = output.length;

  switch (toolName) {
    case "bash":
      return generateBashSummary(nonEmptyLines, totalLines, totalChars, output, context);
    case "read":
      return generateReadSummary(nonEmptyLines, totalLines, totalChars, context?.path);
    case "grep":
      return generateGrepSummary(nonEmptyLines, totalLines, totalChars);
    case "find":
      return generateFindSummary(nonEmptyLines, totalLines, totalChars);
    case "ls":
      return generateLsSummary(nonEmptyLines, totalLines, totalChars);
    default:
      return `📊 ${toolName}: ${totalLines} строк, ${totalChars} символов\nПервые строки:\n${nonEmptyLines.slice(0, 5).join("\n")}`;
  }
}

// ============================================================================
// Bash Summary
// ============================================================================

function generateBashSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  context?: any
): string {
  const command = context?.command || "";
  const cmd = command.trim().split(/\s+/)[0];
  
  // === Git команды ===
  if (cmd === "git") {
    return generateGitCommandSummary(lines, totalLines, totalChars, fullOutput, command);
  }
  
  // === NPM/Yarn/PNPM ===
  if (cmd === "npm" || cmd === "yarn" || cmd === "pnpm") {
    return generatePackageManagerSummary(lines, totalLines, totalChars, fullOutput, command);
  }
  
  // === Docker ===
  if (cmd === "docker") {
    return generateDockerSummary(lines, totalLines, totalChars, fullOutput, command);
  }
  
  // === Build команды (make, cargo, tsc) ===
  if (cmd === "make" || cmd === "cargo" || cmd === "tsc") {
    return generateBuildSummary(lines, totalLines, totalChars, fullOutput, command, cmd);
  }
  
  // === Поиск файлов ===
  if (cmd === "find" || cmd === "fd") {
    return generateFindSummary(lines, totalLines, totalChars);
  }
  
  // === Поиск контента ===
  if (cmd === "grep" || cmd === "rg") {
    return generateGrepSummary(lines, totalLines, totalChars);
  }
  
  // === Список файлов ===
  if (cmd === "ls") {
    return generateLsSummary(lines, totalLines, totalChars);
  }
  
  // === Тесты ===
  if (cmd === "pytest" || cmd === "jest" || cmd === "vitest") {
    return generateTestSummary(lines, totalLines, totalChars, fullOutput);
  }
  
  // === Прочие команды — общий анализ ===
  const analysis = analyzeBash(command, fullOutput);
  
  const parts: string[] = [];
  parts.push(`⚙️ ${analysis.commandType}${analysis.operation !== analysis.commandType ? ` ${analysis.operation}` : ""} выполнена`);
  parts.push(`📊 ${totalLines} строк, ${totalChars} символов`);
  
  if (Object.keys(analysis.details).length > 0) {
    const detailsStr = Object.entries(analysis.details)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    parts.push(`📝 ${detailsStr}`);
  }
  
  const preview = lines.slice(0, 5).join("\n");
  parts.push(`\n📝 Первые строки:\n${preview}`);
  
  return parts.join("\n");
}

// ============================================================================
// Git Command Summary (распределитель)
// ============================================================================

function generateGitCommandSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  command: string
): string {
  const args = command.split(/\s+/).slice(1);
  const subcommand = args[0] || "unknown";
  
  switch (subcommand) {
    case "diff":
      return generateGitDiffSummary(lines, totalLines, totalChars, fullOutput);
    case "log":
      return generateGitLogSummary(lines, totalLines, totalChars, fullOutput);
    case "reflog":
      return generateGitReflogSummary(lines, totalLines, totalChars, fullOutput);
    case "status":
      return generateGitStatusSummary(lines, totalLines, totalChars, fullOutput);
    default:
      return generateGitGenericSummary(lines, totalLines, totalChars, fullOutput, command);
  }
}

function generateGitDiffSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeGitDiff(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🔀 git diff: ${analysis.filesChanged} файлов изменено`);
  parts.push(`📊 +${analysis.insertions} -${analysis.deletions} строк`);
  
  if (analysis.topChangedFiles.length > 0) {
    parts.push(`\n📂 Топ изменённых файлов:`);
    for (const file of analysis.topChangedFiles.slice(0, 10)) {
      const shortPath = file.path.split("/").slice(-2).join("/");
      parts.push(`  ${shortPath}: +${file.insertions} -${file.deletions}`);
    }
    if (analysis.topChangedFiles.length > 10) {
      parts.push(`  ... и ещё ${analysis.topChangedFiles.length - 10} файлов`);
    }
  }
  
  return parts.join("\n");
}

function generateGitLogSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeGitLog(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🔀 git log: ${analysis.totalCommits} коммитов`);
  
  if (analysis.dateRange) {
    parts.push(`📅 Период: ${analysis.dateRange.from} — ${analysis.dateRange.to}`);
  }
  
  if (analysis.authors.length > 0) {
    const authorStr = analysis.authors
      .slice(0, 3)
      .map(a => `${a.name}(${a.count})`)
      .join(", ");
    parts.push(`👥 Авторы: ${authorStr}`);
  }
  
  if (analysis.topSubjects.length > 0) {
    parts.push(`\n📝 Последние коммиты:`);
    for (const commit of analysis.topSubjects.slice(0, 10)) {
      parts.push(`  ${commit.hash} ${commit.subject.slice(0, 70)}`);
    }
  }
  
  return parts.join("\n");
}

function generateGitReflogSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeGitReflog(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🔀 git reflog: ${analysis.totalEntries} записей`);
  
  if (analysis.operations.length > 0) {
    const opsStr = analysis.operations
      .slice(0, 5)
      .map(op => `${op.type}(${op.count})`)
      .join(", ");
    parts.push(`📊 Операции: ${opsStr}`);
  }
  
  if (analysis.entries.length > 0) {
    parts.push(`\n📝 Последние действия:`);
    for (const entry of analysis.entries.slice(0, 10)) {
      parts.push(`  ${entry.index} ${entry.action}: ${entry.message.slice(0, 60)}`);
    }
  }
  
  return parts.join("\n");
}

function generateGitStatusSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeGitStatus(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🔀 git status: ветка ${analysis.currentBranch || "unknown"}`);
  
  const changes: string[] = [];
  if (analysis.modified > 0) changes.push(`${analysis.modified} изменённых`);
  if (analysis.added > 0) changes.push(`${analysis.added} добавленных`);
  if (analysis.deleted > 0) changes.push(`${analysis.deleted} удалённых`);
  if (analysis.renamed > 0) changes.push(`${analysis.renamed} переименованных`);
  if (analysis.untracked > 0) changes.push(`${analysis.untracked} неотслеживаемых`);
  
  if (changes.length > 0) {
    parts.push(`📊 Изменения: ${changes.join(", ")}`);
  } else {
    parts.push(`✅ Рабочая директория чистая`);
  }
  
  return parts.join("\n");
}

function generateGitGenericSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  command: string
): string {
  const analysis = analyzeBash(command, fullOutput);
  
  const parts: string[] = [];
  parts.push(`🔀 git ${analysis.operation}`);
  parts.push(`📊 ${totalLines} строк, ${totalChars} символов`);
  
  if (analysis.details.commits) {
    parts.push(`📝 ${analysis.details.commits} коммитов`);
  }
  if (analysis.details.modified) {
    parts.push(`📝 ${analysis.details.modified} изменённых файлов`);
  }
  
  const preview = lines.slice(0, 10).join("\n");
  parts.push(`\n📝 Вывод:\n${preview}`);
  
  return parts.join("\n");
}

// ============================================================================
// Package Manager Summary (npm/yarn/pnpm)
// ============================================================================

function generatePackageManagerSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  command: string
): string {
  const args = command.split(/\s+/).slice(1);
  const subcommand = args[0] || "unknown";
  
  // Install
  if (subcommand === "install" || subcommand === "add" || subcommand === "i") {
    return generateNpmInstallSummary(lines, totalLines, totalChars, fullOutput);
  }
  
  // Test
  if (subcommand === "test" || subcommand === "jest" || subcommand === "vitest") {
    return generateTestSummary(lines, totalLines, totalChars, fullOutput);
  }
  
  // Build
  if (subcommand === "run" && (args[1] === "build" || args[1] === "compile")) {
    return generateBuildSummary(lines, totalLines, totalChars, fullOutput, command, "npm");
  }
  
  // Прочее
  const analysis = analyzeBash(command, fullOutput);
  const parts: string[] = [];
  parts.push(`📦 ${command.split(/\s+/)[0]} ${subcommand}`);
  parts.push(`📊 ${totalLines} строк, ${totalChars} символов`);
  
  const preview = lines.slice(0, 10).join("\n");
  parts.push(`\n📝 Вывод:\n${preview}`);
  
  return parts.join("\n");
}

function generateNpmInstallSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeNpmInstall(fullOutput);
  
  const parts: string[] = [];
  
  if (analysis.packagesAdded > 0) {
    parts.push(`📦 npm install: добавлено ${analysis.packagesAdded} пакетов`);
  }
  if (analysis.packagesUpdated > 0) {
    parts.push(`🔄 Обновлено ${analysis.packagesUpdated} пакетов`);
  }
  if (analysis.packagesAudited > 0) {
    parts.push(`🔍 Проверено ${analysis.packagesAudited} пакетов`);
  }
  if (analysis.duration) {
    parts.push(`⏱️ Время: ${analysis.duration}`);
  }
  
  // Уязвимости
  const vulnTotal = analysis.vulnerabilities.low + 
                    analysis.vulnerabilities.moderate + 
                    analysis.vulnerabilities.high + 
                    analysis.vulnerabilities.critical;
  
  if (vulnTotal > 0) {
    const vulnParts: string[] = [];
    if (analysis.vulnerabilities.critical > 0) vulnParts.push(`${analysis.vulnerabilities.critical} critical`);
    if (analysis.vulnerabilities.high > 0) vulnParts.push(`${analysis.vulnerabilities.high} high`);
    if (analysis.vulnerabilities.moderate > 0) vulnParts.push(`${analysis.vulnerabilities.moderate} moderate`);
    if (analysis.vulnerabilities.low > 0) vulnParts.push(`${analysis.vulnerabilities.low} low`);
    parts.push(`⚠️ Уязвимости: ${vulnParts.join(", ")}`);
    parts.push(`💡 Запусти \`npm audit fix\` для исправления`);
  }
  
  if (analysis.warnings.length > 0) {
    parts.push(`\n⚠️ Предупреждения:`);
    for (const warn of analysis.warnings.slice(0, 3)) {
      parts.push(`  ${warn.slice(0, 80)}`);
    }
  }
  
  parts.push(`\n${analysis.success ? "✅ Успешно" : "❌ Ошибка"}`);
  
  return parts.join("\n");
}

// ============================================================================
// Docker Summary
// ============================================================================

function generateDockerSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  command: string
): string {
  const args = command.split(/\s+/).slice(1);
  const subcommand = args[0] || "unknown";
  
  // Logs
  if (subcommand === "logs") {
    return generateDockerLogsSummary(lines, totalLines, totalChars, fullOutput);
  }
  
  // PS
  if (subcommand === "ps") {
    return generateDockerPsSummary(lines, totalLines, totalChars, fullOutput);
  }
  
  // Build
  if (subcommand === "build") {
    return generateBuildSummary(lines, totalLines, totalChars, fullOutput, command, "docker");
  }
  
  // Прочее
  const parts: string[] = [];
  parts.push(`🐳 docker ${subcommand}`);
  parts.push(`📊 ${totalLines} строк, ${totalChars} символов`);
  
  const preview = lines.slice(0, 10).join("\n");
  parts.push(`\n📝 Вывод:\n${preview}`);
  
  return parts.join("\n");
}

function generateDockerLogsSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeDockerLogs(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🐳 docker logs: ${analysis.totalLines} строк`);
  
  if (analysis.timeRange) {
    parts.push(`📅 Период: ${analysis.timeRange.from} — ${analysis.timeRange.to}`);
  }
  
  const levelParts: string[] = [];
  if (analysis.errorCount > 0) levelParts.push(`${analysis.errorCount} ошибок`);
  if (analysis.warningCount > 0) levelParts.push(`${analysis.warningCount} предупреждений`);
  if (analysis.infoCount > 0) levelParts.push(`${analysis.infoCount} info`);
  
  if (levelParts.length > 0) {
    parts.push(`📊 Уровни: ${levelParts.join(", ")}`);
  }
  
  if (analysis.commonErrors.length > 0) {
    parts.push(`\n❌ Частые ошибки:`);
    for (const err of analysis.commonErrors.slice(0, 5)) {
      parts.push(`  [${err.count}x] ${err.message.slice(0, 70)}`);
    }
  }
  
  return parts.join("\n");
}

function generateDockerPsSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeDockerPs(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🐳 docker ps: ${analysis.totalContainers} контейнеров`);
  
  const statusParts: string[] = [];
  if (analysis.running > 0) statusParts.push(`${analysis.running} запущено`);
  if (analysis.paused > 0) statusParts.push(`${analysis.paused} приостановлено`);
  if (analysis.stopped > 0) statusParts.push(`${analysis.stopped} остановлено`);
  
  if (statusParts.length > 0) {
    parts.push(`📊 Статус: ${statusParts.join(", ")}`);
  }
  
  if (analysis.containers.length > 0) {
    parts.push(`\n📝 Контейнеры:`);
    for (const container of analysis.containers.slice(0, 10)) {
      parts.push(`  ${container.id.slice(0, 12)} ${container.image} — ${container.status.slice(0, 40)}`);
    }
    if (analysis.containers.length > 10) {
      parts.push(`  ... и ещё ${analysis.containers.length - 10} контейнеров`);
    }
  }
  
  return parts.join("\n");
}

// ============================================================================
// Build Summary (make, cargo, tsc, docker build)
// ============================================================================

function generateBuildSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string,
  command: string,
  buildTool: string
): string {
  const analysis = analyzeBuild(fullOutput, buildTool);
  
  const parts: string[] = [];
  parts.push(`🔨 ${buildTool} build: ${analysis.success ? "✅ Успешно" : "❌ Ошибка"}`);
  
  if (analysis.errors > 0) {
    parts.push(`❌ ${analysis.errors} ошибок`);
  }
  if (analysis.warnings > 0) {
    parts.push(`⚠️ ${analysis.warnings} предупреждений`);
  }
  if (analysis.duration) {
    parts.push(`⏱️ Время: ${analysis.duration}`);
  }
  
  if (analysis.errorMessages.length > 0) {
    parts.push(`\n❌ Ошибки:`);
    for (const err of analysis.errorMessages.slice(0, 5)) {
      const filePart = err.file ? `${err.file}: ` : "";
      parts.push(`  ${filePart}${err.message.slice(0, 70)}`);
    }
    if (analysis.errorMessages.length > 5) {
      parts.push(`  ... и ещё ${analysis.errorMessages.length - 5} ошибок`);
    }
  }
  
  return parts.join("\n");
}

// ============================================================================
// Test Summary
// ============================================================================

function generateTestSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  fullOutput: string
): string {
  const analysis = analyzeNpmTest(fullOutput);
  
  const parts: string[] = [];
  parts.push(`🧪 Тесты: ${analysis.totalTests} всего`);
  
  const statusParts: string[] = [];
  if (analysis.passed > 0) statusParts.push(`✅ ${analysis.passed} пройдено`);
  if (analysis.failed > 0) statusParts.push(`❌ ${analysis.failed} провалено`);
  if (analysis.skipped > 0) statusParts.push(`⏭️ ${analysis.skipped} пропущено`);
  
  if (statusParts.length > 0) {
    parts.push(`📊 Результаты: ${statusParts.join(", ")}`);
  }
  
  if (analysis.duration) {
    parts.push(`⏱️ Время: ${analysis.duration}`);
  }
  
  if (analysis.failedTests.length > 0) {
    parts.push(`\n❌ Проваленные тесты:`);
    for (const test of analysis.failedTests.slice(0, 5)) {
      parts.push(`  ${test.name.slice(0, 60)}`);
      if (test.error) {
        parts.push(`    ${test.error.slice(0, 70)}`);
      }
    }
    if (analysis.failedTests.length > 5) {
      parts.push(`  ... и ещё ${analysis.failedTests.length - 5} тестов`);
    }
  }
  
  return parts.join("\n");
}

// ============================================================================
// Read Summary
// ============================================================================

function generateReadSummary(
  lines: string[],
  totalLines: number,
  totalChars: number,
  path: string = ""
): string {
  const analysis = analyzeRead(lines.join("\n"), path);
  
  const parts: string[] = [];
  
  const fileName = path.split("/").pop() || "файл";
  parts.push(`📄 ${fileName} — ${analysis.language} (${analysis.fileType})`);
  
  const stats = analysis.stats;
  const statsParts: string[] = [];
  statsParts.push(`${stats.totalLines} строк`);
  statsParts.push(`${stats.codeLines} кода`);
  if (stats.functions > 0) statsParts.push(`${stats.functions} функций`);
  if (stats.classes > 0) statsParts.push(`${stats.classes} классов`);
  if (stats.interfaces > 0) statsParts.push(`${stats.interfaces} интерфейсов`);
  if (stats.imports > 0) statsParts.push(`${stats.imports} импортов`);
  if (stats.exports > 0) statsParts.push(`${stats.exports} экспортов`);
  
  parts.push(`📊 ${statsParts.join(", ")}`);
  
  const preview = lines.slice(0, 5).join("\n");
  parts.push(`\n📝 Первые 5 строк:\n${preview}`);
  
  return parts.join("\n");
}

// ============================================================================
// Grep Summary
// ============================================================================

function generateGrepSummary(
  lines: string[],
  totalLines: number,
  totalChars: number
): string {
  const analysis = analyzeGrep(lines.join("\n"));
  
  const parts: string[] = [];
  parts.push(`🔍 grep: ${analysis.totalMatches} совпадений в ${analysis.uniqueFiles} файлах`);
  parts.push(`📊 Размер вывода: ${totalChars} символов`);
  
  if (analysis.topFiles.length > 0) {
    parts.push(`\n📂 Топ файлов:`);
    for (const { file, count } of analysis.topFiles.slice(0, 5)) {
      const shortFile = file.split("/").slice(-2).join("/");
      parts.push(`  ${shortFile}: ${count} совпадений`);
    }
    if (analysis.topFiles.length > 5) {
      parts.push(`  ... и ещё ${analysis.topFiles.length - 5} файлов`);
    }
  }
  
  const preview = lines.slice(0, 3).join("\n");
  parts.push(`\n📝 Примеры совпадений:\n${preview}`);
  
  return parts.join("\n");
}

// ============================================================================
// Find Summary
// ============================================================================

function generateFindSummary(
  lines: string[],
  totalLines: number,
  totalChars: number
): string {
  const analysis = analyzeFind(lines.join("\n"));
  
  const parts: string[] = [];
  parts.push(`📁 find: найдено ${analysis.totalFiles} файлов`);
  
  if (analysis.byExtension.length > 0) {
    const extStr = analysis.byExtension
      .slice(0, 5)
      .map(({ ext, count }) => `.${ext}(${count})`)
      .join(", ");
    parts.push(`📊 По типам: ${extStr}`);
  }
  
  const locationParts: string[] = [];
  if (analysis.inNodeModules > 0) locationParts.push(`${analysis.inNodeModules} в node_modules`);
  if (analysis.inSrc > 0) locationParts.push(`${analysis.inSrc} в src`);
  if (analysis.inTests > 0) locationParts.push(`${analysis.inTests} тестов`);
  
  if (locationParts.length > 0) {
    parts.push(`📂 Расположение: ${locationParts.join(", ")}`);
  }
  
  if (analysis.topDirs.length > 0) {
    parts.push(`\n📂 Топ директорий:`);
    for (const { dir, count } of analysis.topDirs) {
      parts.push(`  ${dir}: ${count} файлов`);
    }
  }
  
  const files = lines.filter(l => l.startsWith("/") || l.startsWith("./"));
  const MAX_PREVIEW_FILES = 10;
  const previewFiles = files.slice(0, MAX_PREVIEW_FILES);
  const preview = previewFiles.join("\n");
  
  parts.push(`\n📝 Первые ${Math.min(MAX_PREVIEW_FILES, files.length)} файлов:\n${preview}`);
  
  if (files.length > MAX_PREVIEW_FILES) {
    parts.push(`... и ещё ${files.length - MAX_PREVIEW_FILES} файлов`);
  }
  
  return parts.join("\n");
}

// ============================================================================
// Ls Summary
// ============================================================================

function generateLsSummary(
  lines: string[],
  totalLines: number,
  totalChars: number
): string {
  let dirs = 0;
  let files = 0;
  let executables = 0;
  let symlinks = 0;
  
  for (const line of lines) {
    if (line.startsWith("d")) dirs++;
    else if (line.startsWith("-")) {
      files++;
      if (line.includes("x")) executables++;
    } else if (line.startsWith("l")) symlinks++;
  }
  
  const parts: string[] = [];
  parts.push(`📂 ls: ${totalLines} элементов`);
  
  const typeParts: string[] = [];
  if (dirs > 0) typeParts.push(`${dirs} директорий`);
  if (files > 0) typeParts.push(`${files} файлов`);
  if (executables > 0) typeParts.push(`${executables} исполняемых`);
  if (symlinks > 0) typeParts.push(`${symlinks} ссылок`);
  
  if (typeParts.length > 0) {
    parts.push(`📊 Типы: ${typeParts.join(", ")}`);
  }
  
  parts.push(`📊 Размер вывода: ${totalChars} символов`);
  
  const preview = lines.slice(0, 15).join("\n");
  parts.push(`\n📝 Содержимое:\n${preview}`);
  
  return parts.join("\n");
}
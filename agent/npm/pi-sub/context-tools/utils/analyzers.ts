/**
 * analyzers.ts — Умные анализаторы вывода инструментов.
 * 
 * Предоставляют детальную статистику для больших выводов:
 * - find: группировка по расширениям, анализ директорий
 * - read: определение языка, подсчёт структур
 * - grep: группировка по файлам
 * - bash: определение типа команды
 * - git: анализ diff, log, reflog, status, blame
 * - npm/pnpm/yarn: install, test, run
 * - docker: logs, ps, images, build
 * - build: make, cargo, tsc
 * - test: pytest, jest, go test
 */

// ============================================================================
// Find Analysis
// ============================================================================

export interface FindAnalysis {
  totalFiles: number;
  byExtension: Array<{ ext: string; count: number }>;
  inNodeModules: number;
  inSrc: number;
  inTests: number;
  topDirs: Array<{ dir: string; count: number }>;
}

export function analyzeFind(output: string): FindAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  const files = lines.filter(l => l.startsWith("/") || l.startsWith("./"));
  
  // Группировка по расширениям
  const extMap = new Map<string, number>();
  for (const file of files) {
    const match = file.match(/\.([a-zA-Z0-9]+)$/);
    const ext = match ? match[1] : "no-ext";
    extMap.set(ext, (extMap.get(ext) || 0) + 1);
  }
  
  const byExtension = Array.from(extMap.entries())
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Подсчёт по директориям
  let inNodeModules = 0;
  let inSrc = 0;
  let inTests = 0;
  
  const dirMap = new Map<string, number>();
  
  for (const file of files) {
    if (file.includes("/node_modules/")) inNodeModules++;
    if (file.includes("/src/")) inSrc++;
    if (file.includes("/test/") || file.includes("/tests/") || 
        file.includes(".test.") || file.includes(".spec.")) inTests++;
    
    // Извлекаем директорию (первые 3 уровня)
    const parts = file.split("/").filter(p => p);
    if (parts.length >= 3) {
      const dir = "/" + parts.slice(0, 3).join("/");
      dirMap.set(dir, (dirMap.get(dir) || 0) + 1);
    }
  }
  
  const topDirs = Array.from(dirMap.entries())
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  return {
    totalFiles: files.length,
    byExtension,
    inNodeModules,
    inSrc,
    inTests,
    topDirs,
  };
}

// ============================================================================
// Read Analysis
// ============================================================================

export interface ReadAnalysis {
  language: string;
  fileType: string;
  stats: {
    totalLines: number;
    codeLines: number;
    emptyLines: number;
    functions: number;
    classes: number;
    imports: number;
    exports: number;
    interfaces: number;
    types: number;
  };
}

const LANGUAGE_PATTERNS: Record<string, { extensions: string[]; keywords: RegExp[] }> = {
  "TypeScript": {
    extensions: [".ts", ".tsx"],
    keywords: [/: (string|number|boolean|any|void)/, /interface\s+\w+/, /type\s+\w+\s*=/],
  },
  "JavaScript": {
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    keywords: [/require\(/, /module\.exports/, /function\s+\w+/],
  },
  "Python": {
    extensions: [".py"],
    keywords: [/def\s+\w+/, /import\s+\w+/, /class\s+\w+.*:/],
  },
  "Go": {
    extensions: [".go"],
    keywords: [/func\s+\w+/, /package\s+\w+/, /import\s+\(/],
  },
  "Rust": {
    extensions: [".rs"],
    keywords: [/fn\s+\w+/, /impl\s+\w+/, /use\s+\w+::/],
  },
  "JSON": {
    extensions: [".json"],
    keywords: [/^\s*{/, /^\s*\[/],
  },
  "Markdown": {
    extensions: [".md", ".mdx"],
    keywords: [/^#\s+/, /^\*\*\s+/, /^\-\s+/],
  },
  "HTML": {
    extensions: [".html", ".htm"],
    keywords: [/<!DOCTYPE/, /<html/, /<div/],
  },
  "CSS": {
    extensions: [".css", ".scss", ".sass", ".less"],
    keywords: [/^\s*\.\w+\s*{/, /^\s*#\w+\s*{/, /@media/],
  },
  "YAML": {
    extensions: [".yml", ".yaml"],
    keywords: [/^\w+:/, /^\s*-\s+/],
  },
  "SQL": {
    extensions: [".sql"],
    keywords: [/SELECT|INSERT|UPDATE|DELETE|CREATE TABLE/i],
  },
  "Shell": {
    extensions: [".sh", ".bash"],
    keywords: [/^#!\/bin\/(bash|sh)/, /^\w+\(\)\s*{/],
  },
  "Docker": {
    extensions: ["Dockerfile", ".dockerfile"],
    keywords: [/^FROM\s+/, /^RUN\s+/, /^CMD\s+/],
  },
};

export function analyzeRead(output: string, path: string = ""): ReadAnalysis {
  const lines = output.split("\n");
  
  // Определяем язык
  const language = detectLanguage(output, path);
  
  // Определяем тип файла
  const fileType = detectFileType(path, output);
  
  // Подсчёт статистики
  let codeLines = 0;
  let emptyLines = 0;
  let functions = 0;
  let classes = 0;
  let imports = 0;
  let exports = 0;
  let interfaces = 0;
  let types = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      emptyLines++;
      continue;
    }
    
    // Пропускаем однострочные комментарии
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
      continue;
    }
    
    codeLines++;
    
    // Подсчёт структур
    if (/\b(function|def|fn|func)\s+\w+/.test(line)) functions++;
    if (/\b(class|interface|struct|enum)\s+\w+/.test(line)) {
      classes++;
      if (/\binterface\s+\w+/.test(line)) interfaces++;
    }
    if (/^(import|from)\s+/.test(line) || /^\s*import\s+/.test(line)) imports++;
    if (/^export\s+/.test(line)) exports++;
    if (/\btype\s+\w+\s*=/.test(line)) types++;
  }
  
  return {
    language,
    fileType,
    stats: {
      totalLines: lines.length,
      codeLines,
      emptyLines,
      functions,
      classes,
      imports,
      exports,
      interfaces,
      types,
    },
  };
}

function detectLanguage(content: string, path: string): string {
  // Сначала по расширению
  const ext = path.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const basename = path.split("/").pop()?.toLowerCase() || "";
  
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (ext && patterns.extensions.includes(`.${ext}`)) {
      return lang;
    }
    if (patterns.extensions.some(e => basename === e.slice(1).toLowerCase())) {
      return lang;
    }
  }
  
  // Потом по содержимому
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    const matches = patterns.keywords.filter(kw => kw.test(content)).length;
    if (matches >= 2) return lang;
  }
  
  return "текстовый файл";
}

function detectFileType(path: string, content: string): string {
  const lower = path.toLowerCase();
  
  // Тесты
  if (lower.includes(".test.") || lower.includes(".spec.") || 
      lower.includes("/test/") || lower.includes("/tests/")) {
    return "тест";
  }
  
  // Конфигурация
  if (lower.includes("config") || lower.includes(".rc") || 
      lower.includes("tsconfig") || lower.includes("package.json") ||
      lower.includes(".env") || lower.includes("dockerfile")) {
    return "конфигурация";
  }
  
  // Компоненты
  if (lower.includes("component") || lower.includes("/components/")) {
    return "компонент";
  }
  
  // Утилиты
  if (lower.includes("util") || lower.includes("helper") || lower.includes("/utils/")) {
    return "утилита";
  }
  
  // Точки входа
  if (lower.endsWith("index.ts") || lower.endsWith("index.js") || 
      lower.endsWith("main.ts") || lower.endsWith("main.js") ||
      lower.endsWith("app.ts") || lower.endsWith("app.js")) {
    return "точка входа";
  }
  
  // Типы
  if (lower.includes("types") || lower.includes(".d.ts") || lower.endsWith("types.ts")) {
    return "определения типов";
  }
  
  return "файл";
}

// ============================================================================
// Grep Analysis
// ============================================================================

export interface GrepAnalysis {
  totalMatches: number;
  uniqueFiles: number;
  byFile: Array<{ file: string; count: number }>;
  topFiles: Array<{ file: string; count: number }>;
}

export function analyzeGrep(output: string): GrepAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  
  // Группируем по файлам (формат grep: file:line:content)
  const fileMap = new Map<string, number>();
  
  for (const line of lines) {
    const match = line.match(/^([^:]+):\d+:/);
    if (match) {
      const file = match[1];
      fileMap.set(file, (fileMap.get(file) || 0) + 1);
    }
  }
  
  const byFile = Array.from(fileMap.entries())
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count);
  
  const topFiles = byFile.slice(0, 10);
  
  return {
    totalMatches: lines.length,
    uniqueFiles: fileMap.size,
    byFile,
    topFiles,
  };
}

// ============================================================================
// Git Analysis (НОВЫЙ)
// ============================================================================

export interface GitDiffAnalysis {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: Array<{ path: string; insertions: number; deletions: number }>;
  topChangedFiles: Array<{ path: string; insertions: number; deletions: number }>;
}

export function analyzeGitDiff(output: string): GitDiffAnalysis {
  const lines = output.split("\n");
  const files: Array<{ path: string; insertions: number; deletions: number }> = [];
  
  let currentFile: { path: string; insertions: number; deletions: number } | null = null;
  let totalInsertions = 0;
  let totalDeletions = 0;
  
  for (const line of lines) {
    // diff --git a/file b/file
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (diffMatch) {
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = { path: diffMatch[2], insertions: 0, deletions: 0 };
      continue;
    }
    
    // +добавленные строки
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (currentFile) currentFile.insertions++;
      totalInsertions++;
    }
    
    // -удалённые строки
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (currentFile) currentFile.deletions++;
      totalDeletions++;
    }
  }
  
  if (currentFile) {
    files.push(currentFile);
  }
  
  // Сортируем по количеству изменений
  const sorted = [...files].sort((a, b) => 
    (b.insertions + b.deletions) - (a.insertions + a.deletions)
  );
  
  return {
    filesChanged: files.length,
    insertions: totalInsertions,
    deletions: totalDeletions,
    files,
    topChangedFiles: sorted.slice(0, 10),
  };
}

export interface GitLogAnalysis {
  totalCommits: number;
  authors: Array<{ name: string; count: number }>;
  dateRange: { from: string; to: string } | null;
  topSubjects: Array<{ subject: string; hash: string }>;
}

export function analyzeGitLog(output: string): GitLogAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  
  // Для --oneline формат: "hash subject"
  // Для обычного формата парсим "Author:" и "Date:"
  const authorMap = new Map<string, number>();
  const subjects: Array<{ subject: string; hash: string }> = [];
  const dates: string[] = [];
  
  let currentAuthor = "";
  let currentDate = "";
  let currentSubject = "";
  let currentHash = "";
  
  for (const line of lines) {
    // Формат oneline: * hash subject или просто hash subject
    const onelineMatch = line.match(/^\*?\s*([a-f0-9]{7,40})\s+(.+)$/);
    if (onelineMatch && !line.startsWith("Author:") && !line.startsWith("Date:")) {
      subjects.push({ hash: onelineMatch[1], subject: onelineMatch[2] });
      continue;
    }
    
    // Формат обычного лога
    if (line.startsWith("commit ")) {
      currentHash = line.slice(7).trim();
      if (currentAuthor) {
        authorMap.set(currentAuthor, (authorMap.get(currentAuthor) || 0) + 1);
      }
    } else if (line.startsWith("Author:")) {
      currentAuthor = line.slice(7).trim().replace(/ <.+>/, "");
    } else if (line.startsWith("Date:")) {
      currentDate = line.slice(5).trim();
      dates.push(currentDate);
    } else if (line.trim() && !line.startsWith("    ")) {
      currentSubject = line.trim();
      if (currentHash && subjects.length < 10) {
        subjects.push({ hash: currentHash.slice(0, 8), subject: currentSubject });
      }
    }
  }
  
  // Добавляем последнего автора
  if (currentAuthor) {
    authorMap.set(currentAuthor, (authorMap.get(currentAuthor) || 0) + 1);
  }
  
  const authors = Array.from(authorMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  return {
    totalCommits: subjects.length || lines.length,
    authors,
    dateRange: dates.length > 0 ? { from: dates[dates.length - 1], to: dates[0] } : null,
    topSubjects: subjects.slice(0, 10),
  };
}

export interface GitReflogAnalysis {
  totalEntries: number;
  operations: Array<{ type: string; count: number }>;
  entries: Array<{ index: string; hash: string; action: string; message: string }>;
}

export function analyzeGitReflog(output: string): GitReflogAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  const entries: Array<{ index: string; hash: string; action: string; message: string }> = [];
  const opMap = new Map<string, number>();
  
  for (const line of lines) {
    // Формат: "hash HEAD@{n}: action: message"
    const match = line.match(/^([a-f0-9]+)\s+HEAD@\{(\d+)\}:\s+([^:]+):\s+(.+)$/);
    if (match) {
      const [_, hash, index, action, message] = match;
      entries.push({ index: `HEAD@{${index}}`, hash, action: action.trim(), message });
      
      // Группируем по типу операции
      const opType = action.split(" ")[0];
      opMap.set(opType, (opMap.get(opType) || 0) + 1);
    }
  }
  
  const operations = Array.from(opMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  
  return {
    totalEntries: entries.length,
    operations,
    entries: entries.slice(0, 20),
  };
}

export interface GitStatusAnalysis {
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  currentBranch: string;
}

export function analyzeGitStatus(output: string): GitStatusAnalysis {
  const lines = output.split("\n");
  let modified = 0;
  let added = 0;
  let deleted = 0;
  let renamed = 0;
  let untracked = 0;
  let currentBranch = "";
  
  let section: "staged" | "unstaged" | "untracked" | null = null;
  
  for (const line of lines) {
    // "On branch main"
    if (line.startsWith("On branch ")) {
      currentBranch = line.slice("On branch ".length);
    }
    
    // "Changes to be committed:"
    if (line.includes("Changes to be committed")) {
      section = "staged";
    }
    // "Changes not staged for commit:"
    else if (line.includes("Changes not staged for commit")) {
      section = "unstaged";
    }
    // "Untracked files:"
    else if (line.includes("Untracked files")) {
      section = "untracked";
    }
    else if (line.trim().startsWith("modified:")) {
      modified++;
    }
    else if (line.trim().startsWith("new file:")) {
      added++;
    }
    else if (line.trim().startsWith("deleted:")) {
      deleted++;
    }
    else if (line.trim().startsWith("renamed:")) {
      renamed++;
    }
    else if (section === "untracked" && line.trim() && !line.includes("Untracked") && !line.includes("(use")) {
      untracked++;
    }
  }
  
  return { modified, added, deleted, renamed, untracked, currentBranch };
}

// ============================================================================
// NPM/Yarn/PNPM Analysis (НОВЫЙ)
// ============================================================================

export interface NpmInstallAnalysis {
  packagesAdded: number;
  packagesUpdated: number;
  packagesRemoved: number;
  packagesAudited: number;
  duration: string;
  vulnerabilities: {
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
  warnings: string[];
  success: boolean;
}

export function analyzeNpmInstall(output: string): NpmInstallAnalysis {
  let packagesAdded = 0;
  let packagesUpdated = 0;
  let packagesRemoved = 0;
  let packagesAudited = 0;
  let duration = "";
  const vulnerabilities = { low: 0, moderate: 0, high: 0, critical: 0 };
  const warnings: string[] = [];
  
  // "added 150 packages, and audited 151 packages in 12s"
  const addedMatch = output.match(/added (\d+) packages?/);
  if (addedMatch) packagesAdded = parseInt(addedMatch[1]);
  
  const updatedMatch = output.match(/updated (\d+) packages?/);
  if (updatedMatch) packagesUpdated = parseInt(updatedMatch[1]);
  
  const removedMatch = output.match(/removed (\d+) packages?/);
  if (removedMatch) packagesRemoved = parseInt(removedMatch[1]);
  
  const auditedMatch = output.match(/audited (\d+) packages?/);
  if (auditedMatch) packagesAudited = parseInt(auditedMatch[1]);
  
  const durationMatch = output.match(/in (\d+s|\d+m|\d+h)/);
  if (durationMatch) duration = durationMatch[1];
  
  // "found 3 moderate severity vulnerabilities"
  const vulnMatch = output.match(/found (\d+) (\w+) severity vulnerabilit(?:y|ies)/);
  if (vulnMatch) {
    const count = parseInt(vulnMatch[1]);
    const level = vulnMatch[2].toLowerCase();
    if (level in vulnerabilities) {
      (vulnerabilities as any)[level] = count;
    }
  }
  
  // "34 vulnerabilities (5 low, 18 moderate, 10 high, 1 critical)"
  const vulnDetails = output.match(/(\d+) low,\s*(\d+) moderate,\s*(\d+) high,\s*(\d+) critical/);
  if (vulnDetails) {
    vulnerabilities.low = parseInt(vulnDetails[1]);
    vulnerabilities.moderate = parseInt(vulnDetails[2]);
    vulnerabilities.high = parseInt(vulnDetails[3]);
    vulnerabilities.critical = parseInt(vulnDetails[4]);
  }
  
  // "npm warn" строки
  const warnLines = output.split("\n").filter(l => l.toLowerCase().includes("warn"));
  for (const line of warnLines.slice(0, 3)) {
    warnings.push(line.trim());
  }
  
  const success = !output.toLowerCase().includes("err!") && 
                  !output.toLowerCase().includes("error:");
  
  return {
    packagesAdded,
    packagesUpdated,
    packagesRemoved,
    packagesAudited,
    duration,
    vulnerabilities,
    warnings,
    success,
  };
}

export interface NpmTestAnalysis {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: string;
  failedTests: Array<{ name: string; error: string }>;
  testSuites: Array<{ name: string; status: string }>;
}

export function analyzeNpmTest(output: string): NpmTestAnalysis {
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration = "";
  const failedTests: Array<{ name: string; error: string }> = [];
  const testSuites: Array<{ name: string; status: string }> = [];
  
  // Jest формат: "Tests: 2 failed, 1 skipped, 47 passed, 50 total"
  const testsMatch = output.match(/Tests:\s+(.+?)\s*$/m);
  if (testsMatch) {
    const testStats = testsMatch[1];
    const passedMatch = testStats.match(/(\d+) passed/);
    const failedMatch = testStats.match(/(\d+) failed/);
    const skippedMatch = testStats.match(/(\d+) skipped/);
    const totalMatch = testStats.match(/(\d+) total/);
    
    if (passedMatch) passed = parseInt(passedMatch[1]);
    if (failedMatch) failed = parseInt(failedMatch[1]);
    if (skippedMatch) skipped = parseInt(skippedMatch[1]);
    if (totalMatch) totalTests = parseInt(totalMatch[1]);
  }
  
  // Pytest формат: "15 passed, 2 failed in 3.45s"
  const pytestMatch = output.match(/(\d+) passed.*?(\d+) failed.*?in ([\d.]+)s/);
  if (pytestMatch) {
    passed = parseInt(pytestMatch[1]);
    failed = parseInt(pytestMatch[2]);
    duration = `${pytestMatch[3]}s`;
    totalTests = passed + failed;
  }
  
  // "Test Suites: 5 passed, 1 failed, 6 total"
  const suitesMatch = output.match(/Test Suites:\s+(.+?)\s*$/m);
  if (suitesMatch) {
    // Можно распарсить тест-сьюты
  }
  
  // Duration
  const durationMatch = output.match(/Time:\s+([\d.]+)\s*s/);
  if (durationMatch) duration = `${durationMatch[1]}s`;
  
  // Сбор информации о проваленных тестах
  const failedBlocks = output.split(/\n\s*●\s+/);
  for (const block of failedBlocks.slice(1, 6)) {
    const lines = block.split("\n");
    const name = lines[0]?.trim() || "unknown";
    const error = lines.slice(1, 4).join("\n").trim();
    failedTests.push({ name, error });
  }
  
  return {
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    failedTests,
    testSuites,
  };
}

// ============================================================================
// Docker Analysis (НОВЫЙ)
// ============================================================================

export interface DockerLogsAnalysis {
  totalLines: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  timeRange: { from: string; to: string } | null;
  commonErrors: Array<{ message: string; count: number }>;
}

export function analyzeDockerLogs(output: string): DockerLogsAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  const errorMessages = new Map<string, number>();
  const dates: string[] = [];
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    if (lower.includes("error") || lower.includes("err") || lower.includes("fatal")) {
      errorCount++;
      // Извлекаем сообщение об ошибке (без timestamp)
      const errorMsg = line.replace(/^\[?[^\]]+\]?\s*/, "").trim().slice(0, 100);
      if (errorMsg) {
        errorMessages.set(errorMsg, (errorMessages.get(errorMsg) || 0) + 1);
      }
    } else if (lower.includes("warn")) {
      warningCount++;
    } else if (lower.includes("info")) {
      infoCount++;
    }
    
    // Извлекаем timestamp "2024-01-15T12:34:56"
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (dateMatch) dates.push(dateMatch[1]);
  }
  
  const commonErrors = Array.from(errorMessages.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  return {
    totalLines: lines.length,
    errorCount,
    warningCount,
    infoCount,
    timeRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    commonErrors,
  };
}

export interface DockerPsAnalysis {
  totalContainers: number;
  running: number;
  paused: number;
  stopped: number;
  containers: Array<{ id: string; image: string; status: string; ports: string }>;
}

export function analyzeDockerPs(output: string): DockerPsAnalysis {
  const lines = output.split("\n").filter(l => l.trim());
  // Первая строка — заголовки
  const dataLines = lines.slice(1);
  
  let running = 0;
  let paused = 0;
  let stopped = 0;
  const containers: Array<{ id: string; image: string; status: string; ports: string }> = [];
  
  for (const line of dataLines) {
    const lower = line.toLowerCase();
    if (lower.includes("up ")) running++;
    else if (lower.includes("paused")) paused++;
    else if (lower.includes("exited")) stopped++;
    
    // Простой парсинг: ID IMAGE COMMAND CREATED STATUS PORTS NAMES
    const parts = line.split(/\s{2,}/);
    if (parts.length >= 5) {
      containers.push({
        id: parts[0],
        image: parts[1],
        status: parts[4],
        ports: parts[5] || "",
      });
    }
  }
  
  return {
    totalContainers: dataLines.length,
    running,
    paused,
    stopped,
    containers: containers.slice(0, 20),
  };
}

// ============================================================================
// Build Analysis (НОВЫЙ)
// ============================================================================

export interface BuildAnalysis {
  success: boolean;
  errors: number;
  warnings: number;
  duration: string;
  errorMessages: Array<{ message: string; file?: string }>;
  warningMessages: Array<{ message: string; file?: string }>;
}

export function analyzeBuild(output: string, commandType: string = ""): BuildAnalysis {
  const lines = output.split("\n");
  let errors = 0;
  let warnings = 0;
  let duration = "";
  const errorMessages: Array<{ message: string; file?: string }> = [];
  const warningMessages: Array<{ message: string; file?: string }> = [];
  
  // "Found 5 errors" или "5 errors"
  const errorsMatch = output.match(/(\d+) error/i);
  if (errorsMatch) errors = parseInt(errorsMatch[1]);
  
  const warningsMatch = output.match(/(\d+) warning/i);
  if (warningsMatch) warnings = parseInt(warningsMatch[1]);
  
  // Duration "Done in 12.34s"
  const durationMatch = output.match(/(?:Done|Compiled|Finished) in ([\d.]+)s/);
  if (durationMatch) duration = `${durationMatch[1]}s`;
  
  // "Compiled successfully" или "Build completed"
  const success = /success|compiled|built|completed/i.test(output) && 
                  errors === 0 && 
                  !output.toLowerCase().includes("failed");
  
  // TypeScript формат: "src/file.ts(10,5): error TS2304: Cannot find name"
  const tsErrors = output.match(/.+?\(\d+,\d+\):\s*error\s+\w+:\s*.+/g);
  if (tsErrors) {
    for (const err of tsErrors.slice(0, 10)) {
      const match = err.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/);
      if (match) {
        errorMessages.push({
          file: `${match[1]}:${match[2]}:${match[3]}`,
          message: match[4],
        });
      }
    }
  }
  
  return {
    success,
    errors,
    warnings,
    duration,
    errorMessages,
    warningMessages,
  };
}

// ============================================================================
// Bash Analysis
// ============================================================================

export interface BashAnalysis {
  commandType: string;
  operation: string;
  details: Record<string, any>;
}

export function analyzeBash(command: string, output: string): BashAnalysis {
  const cmd = command.trim().split(/\s+/)[0];
  
  // Определяем тип команды
  const commandType = detectCommandType(cmd, command);
  
  // Определяем операцию
  const operation = detectOperation(commandType, command);
  
  // Детали в зависимости от типа
  const details = extractDetails(commandType, command, output);
  
  return { commandType, operation, details };
}

function detectCommandType(cmd: string, fullCommand: string): string {
  const cmdMap: Record<string, string> = {
    "git": "git",
    "npm": "npm",
    "yarn": "yarn",
    "pnpm": "pnpm",
    "docker": "docker",
    "cargo": "cargo",
    "go": "go",
    "python": "python",
    "python3": "python",
    "pip": "pip",
    "pip3": "pip",
    "curl": "curl",
    "wget": "wget",
    "make": "make",
    "cmake": "cmake",
    "find": "find",
    "grep": "grep",
    "rg": "ripgrep",
    "fd": "fd",
    "ls": "ls",
    "cat": "cat",
    "head": "head",
    "tail": "tail",
    "wc": "wc",
    "sort": "sort",
    "uniq": "uniq",
    "awk": "awk",
    "sed": "sed",
    "echo": "echo",
    "node": "node",
    "npx": "npx",
    "tsx": "tsx",
    "ts-node": "ts-node",
    "tsc": "tsc",
    "pytest": "pytest",
    "jest": "jest",
    "tree": "tree",
    "du": "du",
    "df": "df",
    "ps": "ps",
    "top": "top",
  };
  
  return cmdMap[cmd] || "other";
}

function detectOperation(commandType: string, command: string): string {
  const args = command.split(/\s+/).slice(1);
  
  switch (commandType) {
    case "git":
      return args[0] || "unknown";
    case "npm":
    case "yarn":
    case "pnpm":
      return args[0] === "run" ? args[1] : args[0];
    case "docker":
      return args[0] || "unknown";
    case "cargo":
    case "go":
      return args[0] || "unknown";
    case "find":
    case "grep":
    case "rg":
    case "fd":
      return "search";
    case "curl":
    case "wget":
      return "fetch";
    default:
      return commandType;
  }
}

function extractDetails(commandType: string, command: string, output: string): Record<string, any> {
  const details: Record<string, any> = {};
  
  switch (commandType) {
    case "git":
      if (command.includes("git log")) {
        const analysis = analyzeGitLog(output);
        details.commits = analysis.totalCommits;
        details.authors = analysis.authors;
        details.dateRange = analysis.dateRange;
      }
      if (command.includes("git status")) {
        const analysis = analyzeGitStatus(output);
        details.modified = analysis.modified;
        details.added = analysis.added;
        details.deleted = analysis.deleted;
        details.untracked = analysis.untracked;
        details.currentBranch = analysis.currentBranch;
      }
      if (command.includes("git diff")) {
        const analysis = analyzeGitDiff(output);
        details.filesChanged = analysis.filesChanged;
        details.insertions = analysis.insertions;
        details.deletions = analysis.deletions;
        details.topChangedFiles = analysis.topChangedFiles;
      }
      if (command.includes("git reflog")) {
        const analysis = analyzeGitReflog(output);
        details.entries = analysis.totalEntries;
        details.operations = analysis.operations;
      }
      if (command.includes("git blame")) {
        details.lines = output.split("\n").filter(l => l.trim()).length;
      }
      break;
      
    case "npm":
    case "yarn":
    case "pnpm":
      if (command.includes("install") || command.includes("add")) {
        const analysis = analyzeNpmInstall(output);
        details.packagesAdded = analysis.packagesAdded;
        details.packagesUpdated = analysis.packagesUpdated;
        details.packagesRemoved = analysis.packagesRemoved;
        details.packagesAudited = analysis.packagesAudited;
        details.duration = analysis.duration;
        details.vulnerabilities = analysis.vulnerabilities;
        details.success = analysis.success;
      }
      if (command.includes("test") || command.includes("jest") || command.includes("vitest")) {
        const analysis = analyzeNpmTest(output);
        details.totalTests = analysis.totalTests;
        details.passed = analysis.passed;
        details.failed = analysis.failed;
        details.skipped = analysis.skipped;
        details.duration = analysis.duration;
        details.failedTests = analysis.failedTests;
      }
      if (command.includes("run build") || command.includes(" build")) {
        const analysis = analyzeBuild(output, "npm");
        details.success = analysis.success;
        details.errors = analysis.errors;
        details.warnings = analysis.warnings;
        details.duration = analysis.duration;
      }
      break;
      
    case "find":
    case "fd":
      details.files = output.split("\n").filter(l => l.trim()).length;
      break;
      
    case "grep":
    case "rg":
      details.matches = output.split("\n").filter(l => l.trim()).length;
      break;
      
    case "ls":
      details.items = output.split("\n").filter(l => l.trim()).length;
      if (command.includes("-R")) {
        details.recursive = true;
        // Подсчёт директорий в рекурсивном выводе
        details.directories = (output.match(/^\S+:$/gm) || []).length;
      }
      break;
      
    case "wc":
      const wcMatch = output.match(/(\d+)\s+(\d+)\s+(\d+)/);
      if (wcMatch) {
        details.lines = parseInt(wcMatch[1]);
        details.words = parseInt(wcMatch[2]);
        details.bytes = parseInt(wcMatch[3]);
      }
      break;
      
    case "docker":
      if (command.includes("docker logs")) {
        const analysis = analyzeDockerLogs(output);
        details.totalLines = analysis.totalLines;
        details.errors = analysis.errorCount;
        details.warnings = analysis.warningCount;
        details.commonErrors = analysis.commonErrors;
        details.timeRange = analysis.timeRange;
      }
      if (command.includes("docker ps")) {
        const analysis = analyzeDockerPs(output);
        details.totalContainers = analysis.totalContainers;
        details.running = analysis.running;
        details.paused = analysis.paused;
        details.stopped = analysis.stopped;
      }
      if (command.includes("docker build")) {
        const analysis = analyzeBuild(output, "docker");
        details.success = analysis.success;
        details.errors = analysis.errors;
        details.duration = analysis.duration;
      }
      break;
      
    case "python":
    case "pip":
      if (command.includes("pip install") || command.includes("pip3 install")) {
        details.success = !output.toLowerCase().includes("error");
        details.packages = (output.match(/Successfully installed .+$/m) || [""])[0];
      }
      if (command.includes("pytest") || command.includes("python -m pytest")) {
        const analysis = analyzeNpmTest(output);
        details.totalTests = analysis.totalTests;
        details.passed = analysis.passed;
        details.failed = analysis.failed;
        details.duration = analysis.duration;
      }
      break;
      
    case "cargo":
    case "make":
    case "tsc":
      const buildAnalysis = analyzeBuild(output, commandType);
      details.success = buildAnalysis.success;
      details.errors = buildAnalysis.errors;
      details.warnings = buildAnalysis.warnings;
      details.duration = buildAnalysis.duration;
      details.errorMessages = buildAnalysis.errorMessages;
      break;
      
    case "curl":
    case "wget":
      const sizeMatch = output.match(/(\d+(?:\.\d+)?[KMGT]?B)/);
      if (sizeMatch) details.size = sizeMatch[1];
      const statusMatch = output.match(/HTTP\/\d+\.\d+\s+(\d+)/);
      if (statusMatch) details.httpStatus = statusMatch[1];
      break;
      
    case "du":
      const duMatch = output.match(/^([\d.]+[KMGT]?)\s+(.+)$/m);
      if (duMatch) {
        details.size = duMatch[1];
        details.path = duMatch[2];
      }
      break;
      
    case "df":
      const dfMatch = output.match(/(\d+(?:\.\d+)?%)/);
      if (dfMatch) details.usage = dfMatch[1];
      break;
      
    case "ps":
      details.processes = output.split("\n").filter(l => l.trim()).length - 1;
      break;
  }
  
  return details;
}
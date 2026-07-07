/**
 * fast-tools.ts — Детекция и использование быстрых альтернатив стандартных инструментов.
 * 
 * v13: Исправлена уязвимость shell injection:
 *      - Заменён `which` на `command -v` (более безопасный и POSIX-совместимый)
 *      - Добавлена функция escapeShellArg для экранирования аргументов
 *      - buildFindCommand и buildGrepCommand теперь экранируют все пользовательские ввод
 */

import { execSync } from "node:child_process";

export interface FastToolsConfig {
  find: "find" | "fd" | "fdfind";
  grep: "grep" | "rg";
}

let cachedConfig: FastToolsConfig | null = null;

/**
 * v13: Экранирует аргумент для безопасной передачи в shell.
 * 
 * Использует одинарные кавычки — стандартный способ shell escaping.
 * Работает для bash, sh, zsh. Защищает от инъекций через:
 * - Двойные кавычки: "
 * - Обратные кавычки: `
 * - Переменные: $
 * - Команды: ; & |
 * - Перенаправления: < >
 * - Комментарии: #
 * - И другие shell-метасимволы
 */
function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * v13: Заменён `which` на `command -v` для безопасности.
 * 
 * `which` может быть уязвим к инъекции через cmd.
 * `command -v` — встроенная команда bash, не зависит от внешних утилит.
 * Также экранируем аргумент через escapeShellArg.
 */
function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${escapeShellArg(cmd)}`, { stdio: "ignore", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

export function detectFastTools(): FastToolsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const config: FastToolsConfig = {
    find: "find",
    grep: "grep",
  };

  if (commandExists("fd")) {
    config.find = "fd";
    console.log(`[igorpi-subagents] ⚡ Using fd instead of find (faster, respects .gitignore)`);
  } else if (commandExists("fdfind")) {
    config.find = "fdfind";
    console.log(`[igorpi-subagents] ⚡ Using fdfind instead of find (faster, respects .gitignore)`);
  } else {
    console.log(`[igorpi-subagents] 📦 Using standard find (install fd-find for better performance: sudo apt install fd-find)`);
  }

  if (commandExists("rg")) {
    config.grep = "rg";
    console.log(`[igorpi-subagents] ⚡ Using rg instead of grep (faster, respects .gitignore)`);
  } else {
    console.log(`[igorpi-subagents] 📦 Using standard grep (install ripgrep for better performance: sudo apt install ripgrep)`);
  }

  cachedConfig = config;
  return config;
}

export function getFastToolsSync(): FastToolsConfig {
  return cachedConfig || detectFastTools();
}

export function resetFastToolsCache(): void {
  cachedConfig = null;
}

/**
 * v13: Экранирует все пользовательские ввод для защиты от shell injection.
 */
export function buildFindCommand(
  pattern: string,
  searchPath: string,
  limit: number,
  config: FastToolsConfig
): string {
  const safePattern = escapeShellArg(pattern);
  const safePath = escapeShellArg(searchPath);
  
  let command: string;
  
  if (config.find === "fd" || config.find === "fdfind") {
    const cmd = config.find;
    command = `${cmd} --type f ${safePattern} ${safePath} 2>/dev/null | head -n ${limit}`;
    console.log(`[igorpi-subagents] ⚡ Using ${cmd} for find command`);
  } else {
    command = `find ${safePath} -name ${safePattern} -type f 2>/dev/null | head -n ${limit}`;
    console.log(`[igorpi-subagents] 📦 Using standard find command`);
  }
  
  return command;
}

/**
 * v13: Экранирует все пользовательские ввод для защиты от shell injection.
 */
export function buildGrepCommand(
  pattern: string,
  searchPath: string,
  options: string,
  config: FastToolsConfig
): string {
  const safePattern = escapeShellArg(pattern);
  const safePath = escapeShellArg(searchPath);
  const safeOptions = escapeShellArg(options);
  
  let command: string;
  
  if (config.grep === "rg") {
    command = `rg --line-number --no-heading --color never ${safePattern} ${safePath} 2>/dev/null || true`;
    console.log(`[igorpi-subagents] ⚡ Using rg for grep command`);
  } else {
    command = `grep ${safeOptions} ${safePattern} ${safePath} 2>/dev/null || true`;
    console.log(`[igorpi-subagents] 📦 Using standard grep command`);
  }
  
  return command;
}
/**
 * fast-tools.ts — Детекция и использование быстрых альтернатив стандартных инструментов.
 */

import { execSync } from "node:child_process";

export interface FastToolsConfig {
  find: "find" | "fd" | "fdfind";
  grep: "grep" | "rg";
}

let cachedConfig: FastToolsConfig | null = null;

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore", timeout: 1000 });
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
    console.log(`[pi-sub] ⚡ Using fd instead of find (faster, respects .gitignore)`);
  } else if (commandExists("fdfind")) {
    config.find = "fdfind";
    console.log(`[pi-sub] ⚡ Using fdfind instead of find (faster, respects .gitignore)`);
  } else {
    console.log(`[pi-sub] 📦 Using standard find (install fd-find for better performance: sudo apt install fd-find)`);
  }

  if (commandExists("rg")) {
    config.grep = "rg";
    console.log(`[pi-sub] ⚡ Using rg instead of grep (faster, respects .gitignore)`);
  } else {
    console.log(`[pi-sub] 📦 Using standard grep (install ripgrep for better performance: sudo apt install ripgrep)`);
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

export function buildFindCommand(
  pattern: string,
  searchPath: string,
  limit: number,
  config: FastToolsConfig
): string {
  let command: string;
  
  if (config.find === "fd" || config.find === "fdfind") {
    const cmd = config.find;
    command = `${cmd} --type f "${pattern}" "${searchPath}" 2>/dev/null | head -n ${limit}`;
    console.log(`[pi-sub] ⚡ Using ${cmd} for find command`);
  } else {
    command = `find "${searchPath}" -name "${pattern}" -type f 2>/dev/null | head -n ${limit}`;
    console.log(`[pi-sub] 📦 Using standard find command`);
  }
  
  return command;
}

export function buildGrepCommand(
  pattern: string,
  searchPath: string,
  options: string,
  config: FastToolsConfig
): string {
  let command: string;
  
  if (config.grep === "rg") {
    command = `rg --line-number --no-heading --color never "${pattern}" "${searchPath}" 2>/dev/null || true`;
    console.log(`[pi-sub] ⚡ Using rg for grep command`);
  } else {
    command = `grep ${options} "${pattern}" "${searchPath}" 2>/dev/null || true`;
    console.log(`[pi-sub] 📦 Using standard grep command`);
  }
  
  return command;
}
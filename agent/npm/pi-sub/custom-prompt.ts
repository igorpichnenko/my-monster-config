/**
 * custom-prompt.ts — Генерация кастомного системного промпта.
 * Вынесено из index.ts.
 */

import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

/**
 * Получить путь к pi-coding-agent динамически.
 * Использует createRequire для ES-модулей.
 * 
 * v14: Убран хардкод пути, теперь используется динамическое определение
 */
function getPiCodingAgentPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const piPackagePath = require.resolve("@earendil-works/pi-coding-agent/package.json");
    return dirname(piPackagePath);
  } catch {
    // Fallback: ищем node_modules относительно текущего файла
    const fallbackPaths = [
      // Относительно текущего файла (для локальной разработки)
      join(dirname(new URL(import.meta.url).pathname), "../../node_modules/@earendil-works/pi-coding-agent"),
      // Относительно process.cwd() (для глобальной установки)
      join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent"),
      // Относительно HOME (для nvm)
      join(process.env.HOME || "", ".nvm/versions/node", process.version, "lib/node_modules/@earendil-works/pi-coding-agent"),
    ];
    
    for (const path of fallbackPaths) {
      if (existsSync(path)) {
        return path;
      }
    }
    
    // Последний fallback: используем require.resolve с другим путём
    try {
      const require = createRequire(import.meta.url);
      return require.resolve("@earendil-works/pi-coding-agent");
    } catch {
      // Если ничего не сработало, возвращаем относительный путь
      return "node_modules/@earendil-works/pi-coding-agent";
    }
  }
}

export function buildCustomPrompt(): { systemPrompt: string } {
  const piPath = getPiCodingAgentPath();
  const customPrompt = `You are an expert coding assistant in pi with persistent memory across sessions.

## Available Tools
- bash: Execute commands
- read: Read files
- edit: Edit files using exact text replacement
- write: Create or overwrite files
- grep: Search file contents (regex)
- find: Search files by pattern
- ls: List directory contents
- ctx_search: Search saved outputs (use 'id:<n>' for full output)

## Context Preservation
Large outputs (>5000 chars) from bash, read, grep, find, ls are auto-saved to SQLite DB.
Use ctx_search to retrieve full saved output or search past results.
Memory contains: decisions, lessons, preferences, architecture notes, API details.
Repo/tool evidence wins over memory when they conflict.

## Pi Documentation
Read only when user asks about pi itself, SDK, extensions, themes, skills, or TUI:
- Main: ${join(piPath, "README.md")}
- Docs: ${join(piPath, "docs")} (resolve docs/... here)
- Examples: ${join(piPath, "examples")} (resolve examples/... here)
- Key files: docs/extensions.md, docs/themes.md, docs/skills.md, docs/tui.md, docs/sdk.md
- Always read .md files fully and follow cross-references

## Guidelines
- Be concise
- Show file paths clearly
- Use specialized tools over bash (read not cat, edit not sed)
- Make independent tool calls in parallel
- Use absolute file paths

Current date: ${new Date().toISOString().split("T")[0]}
Current working directory: ${process.cwd()}`;
  return { systemPrompt: customPrompt };
}
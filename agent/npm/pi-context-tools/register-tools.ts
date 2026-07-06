/**
 * register-tools.ts — Регистрация инструментов с перезаписью стандартных.
 * 
 * Оптимизировано для минимального размера system prompt:
 * - Убраны description из параметров (экономия ~100 токенов)
 * - ctx_stats закомментирован (экономия ~50-80 токенов)
 * - Добавлена подсказка Ctrl+O для разворачивания результатов
 * - ctx_search поддерживает expanded через Ctrl+O
 * - Phase 12: Улучшена обработка пустых результатов и приоритетов
 * 
 * v13: Исправлена SQL injection в grep/find:
 *      - Добавлена функция escapeShellArg для экранирования shell-метасимволов
 *      - Паттерн, путь и опции теперь безопасно передаются в shell
 *      - Защита от атак типа pattern='"; rm -rf /; #'
 * 
 * v14: Перенесён из pi-sub/tools/ в pi-context-tools/
 *      - Обновлены импорты на pi-memory и локальные tools/
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import type { MemoryDatabase } from "pi-memory";
import { executeCtxBash, type CtxBashArgs } from "./tools/ctx-bash.js";
import { executeCtxRead, type CtxReadArgs } from "./tools/ctx-read.js";
import { executeCtxSearch, type CtxSearchArgs } from "./tools/ctx-search.js";

/** Подсказка для разворачивания результата */
const EXPAND_HINT = " (Ctrl+O to expand)";

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
 * 
 * Пример:
 *   escapeShellArg('test"; rm -rf /; #') → "'test\"; rm -rf /; #'"
 */
function escapeShellArg(arg: string): string {
  // Оборачиваем в одинарные кавычки и экранируем одинарные кавычки внутри
  // 'test' → 'test'
  // test's → 'test'\''s'
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Общий renderResult для инструментов с сохранением в БД */
function renderSavedToDb(result: any, { expanded, isPartial }: any, theme: any, label: string) {
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  
  if (isPartial) {
    return new Text(theme.fg("accent", "⠙") + ` ${label}…`, 0, 0);
  }
  
  // Если текст пустой — показываем предупреждение вместо "empty"
  if (!text || text.length === 0) {
    return new Text(
      theme.fg("warning", "⚠") + " done (no results)" + 
      theme.fg("dim", " — команда не нашла совпадений"),
      0, 0
    );
  }
  
  // Получаем первую строку для превью
  const firstLine = text.split("\n").find((l: string) => l.trim()) || "";
  const preview = firstLine.slice(0, 100);
  
  // Если результат малый (< 200 символов) — показываем полностью, но с возможностью свернуть
  if (text.length < 200) {
    if (expanded) {
      return new Text(theme.fg("success", "✓ done\n") + theme.fg("dim", text), 0, 0);
    } else {
      return new Text(
        theme.fg('success', '✓ done') +
          theme.fg('dim', ` — ${preview}`) +
          theme.fg('muted', EXPAND_HINT),
        0,
        0
      );
    }
  }
  
  // Для больших результатов с "💾 Полный вывод сохранён"
  if (text.includes("💾 Полный вывод сохранён") || text.includes("💾 Полное содержимое файла сохранено") || text.includes("Полный вывод сохранён")) {
    const summaryMatch = text.match(/^(.*?)\n\n/s);
    const summary = summaryMatch ? summaryMatch[1] : text.slice(0, 200);
    
    if (expanded) {
      return new Text(theme.fg("success", "✓ saved to DB\n\n") + theme.fg("dim", summary), 0, 0);
    } else {
      const summaryFirstLine = summary.split("\n").find((l: string) => l.trim()) || "";
      return new Text(
        theme.fg('success', '✓ saved to DB') +
          theme.fg('dim', ` — ${summaryFirstLine.slice(0, 80)}`) +
          theme.fg('muted', EXPAND_HINT),
        0,
        0
      );
    }
  }
  
  // Для результатов с дубликатами (♻️)
  if (text.includes("♻️")) {
    const summaryMatch = text.match(/^(.*?)\n\n/s);
    const summary = summaryMatch ? summaryMatch[1] : text.slice(0, 200);
    
    if (expanded) {
      return new Text(theme.fg("success", "✓ duplicate detected\n\n") + theme.fg("dim", summary), 0, 0);
    } else {
      const summaryFirstLine = summary.split("\n").find((l: string) => l.trim()) || "";
      return new Text(
        theme.fg('success', '✓ duplicate detected') +
          theme.fg('dim', ` — ${summaryFirstLine.slice(0, 80)}`) +
          theme.fg('muted', EXPAND_HINT),
        0,
        0
      );
    }
  }
  
  // Для остальных больших результатов
  if (expanded) {
    return new Text(theme.fg("success", "✓ done\n\n") + theme.fg("dim", text.slice(0, 500)), 0, 0);
  } else {
    return new Text(
      theme.fg('success', '✓ done') +
        theme.fg('dim', ` — ${preview}`) +
        theme.fg('muted', EXPAND_HINT),
      0,
      0
    );
  }
}

export function registerTools(pi: ExtensionAPI, memoryDb: MemoryDatabase): void {
  // ---- bash (заменяет стандартный) ----
  pi.registerTool(defineTool({
    name: "bash",
    label: "bash",
    description: "Execute bash command with context preservation. Large outputs (>5000 chars) are automatically saved to database and replaced with summary. Use ctx_search to find details later.",
    promptSnippet: "Execute bash with context preservation",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("bash")) + " " + theme.fg("dim", args.command.slice(0, 50)), 0, 0);
    },
    
    renderResult(result, opts, theme) {
      return renderSavedToDb(result, opts, theme, "running");
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const result = await executeCtxBash(
          { command: params.command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));

  // ---- read (заменяет стандартный) ----
  pi.registerTool(defineTool({
    name: "read",
    label: "read",
    description: "Read file contents with context preservation. Supports offset/limit for large files. Large outputs (>5000 chars) are automatically saved to database and replaced with summary. Use ctx_search with 'id:<number>' to get full output.",
    promptSnippet: "Read file with context preservation",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("read")) + " " + theme.fg("dim", args.path.slice(0, 50)), 0, 0);
    },
    
    renderResult(result, opts, theme) {
      return renderSavedToDb(result, opts, theme, "reading");
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const result = await executeCtxRead(
          { path: params.path, offset: params.offset, limit: params.limit } as CtxReadArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));

  // ---- grep (заменяет стандартный) ----
  pi.registerTool(defineTool({
    name: "grep",
    label: "grep",
    description: "Search for pattern in files with context preservation. Large outputs (>5000 chars) are automatically saved to database and replaced with summary. Use ctx_search to find details later.",
    promptSnippet: "Search files with context preservation",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      options: Type.Optional(Type.String()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("grep")) + " " + theme.fg("dim", args.pattern.slice(0, 30)), 0, 0);
    },
    
    renderResult(result, opts, theme) {
      return renderSavedToDb(result, opts, theme, "searching");
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const searchPath = params.path || ".";
        const options = params.options || "-rn";
        
        // v13: Экранируем все пользовательские ввод для защиты от shell injection
        const safePattern = escapeShellArg(params.pattern);
        const safePath = escapeShellArg(searchPath);
        const safeOptions = escapeShellArg(options);
        
        // Команда использует экранированные аргументы в одинарных кавычках
        const command = `grep ${safeOptions} --exclude-dir=.git ${safePattern} ${safePath} 2>/dev/null || true`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));

  // ---- find (заменяет стандартный) ----
  pi.registerTool(defineTool({
    name: "find",
    label: "find",
    description: "Search for files by pattern with context preservation. Large outputs (>5000 chars) are automatically saved to database and replaced with summary. Use ctx_search to find details later.",
    promptSnippet: "Find files with context preservation",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("find")) + " " + theme.fg("dim", args.pattern.slice(0, 30)), 0, 0);
    },
    
    renderResult(result, opts, theme) {
      return renderSavedToDb(result, opts, theme, "searching");
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const searchPath = params.path || ".";
        const limit = params.limit || 1000;
        
        // v13: Экранируем все пользовательские ввод для защиты от shell injection
        const safePattern = escapeShellArg(params.pattern);
        const safePath = escapeShellArg(searchPath);
        
        // Команда использует экранированные аргументы в одинарных кавычках
        const command = `find ${safePath} -not -path '*/.git/*' -name ${safePattern} -type f 2>/dev/null | head -n ${limit}`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));

  // ---- ls (заменяет стандартный) ----
  pi.registerTool(defineTool({
    name: "ls",
    label: "ls",
    description: "List directory contents with context preservation. Large outputs (>5000 chars) are automatically saved to database and replaced with summary. Use ctx_search to find details later.",
    promptSnippet: "List directory with context preservation",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
      options: Type.Optional(Type.String()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("ls")) + " " + theme.fg("dim", args.path || "."), 0, 0);
    },
    
    renderResult(result, opts, theme) {
      return renderSavedToDb(result, opts, theme, "listing");
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const searchPath = params.path || ".";
        const options = params.options || "-la";
        
        // v13: Экранируем для защиты от shell injection
        const safePath = escapeShellArg(searchPath);
        const safeOptions = escapeShellArg(options);
        
        const command = `ls ${safeOptions} ${safePath}`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));

  // ---- ctx_search (с поддержкой expanded через Ctrl+O) ----
  pi.registerTool(defineTool({
    name: "ctx_search",
    label: "Search Context DB",
    description: "Search through saved tool outputs and file contents using full-text search (FTS5). Use query 'id:<number>' to get full output by ID.",
    promptSnippet: "Search saved outputs",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Number()),
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("ctx_search")) + " " + theme.fg("dim", args.query.slice(0, 50)), 0, 0);
    },
    
    renderResult(result, { expanded, isPartial }: any, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      
      if (isPartial) {
        return new Text(theme.fg("accent", "⠙") + " searching…", 0, 0);
      }
      
      // Если текст пустой
      if (!text || text.length === 0) {
        return new Text(theme.fg("warning", "⚠") + " no results", 0, 0);
      }
      
      // Определяем формат вывода и извлекаем количество результатов
      let count = "0";
      let title = "results";
      
      if (text.includes("Full Output [ID:") || text.includes("Full Subagent Result [ID:") || 
          text.includes("Full Session Fact [ID:") || text.includes("Full Compaction Summary [ID:") ||
          text.includes("Full Compressed Result [ID:") || text.includes("Compaction Summary [ID:")) {
        // Поиск по ID — всегда 1 результат
        count = "1";
        title = "output";
      } else if (text.includes("No result found with ID:")) {
        // ID не найден
        count = "0";
        title = "results";
      } else if (text.includes("No results found for:")) {
        // Обычный поиск не нашёл результатов
        count = "0";
        title = "results";
      } else {
        // Обычный поиск с результатами
        const match = text.match(/Found (\d+) result/);
        count = match ? match[1] : "0";
        title = "results";
      }
      
      // Если развёрнуто — показываем полный результат
      if (expanded) {
        return new Text(
          theme.fg("success", `✓ found ${count} ${title}\n\n`) + 
          theme.fg("dim", text),
          0,
          0
        );
      }
      
      // Свёрнуто — показываем превью (первые 3 строки)
      const previewLines = text.split("\n").slice(0, 3).join("\n");
      const firstLine = text.split("\n")[0] || "";
      
      return new Text(
        theme.fg("success", `✓ found ${count} ${title}`) +
          theme.fg("dim", ` — ${firstLine.slice(0, 80)}`) +
          theme.fg("muted", EXPAND_HINT),
        0,
        0
      );
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const result = executeCtxSearch(params as CtxSearchArgs, memoryDb);
        return { content: [{ type: "text" as const, text: result }], details: {} };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], details: {} };
      }
    },
  }));
}
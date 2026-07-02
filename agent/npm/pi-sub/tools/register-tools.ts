/**
 * register-tools.ts — Регистрация инструментов с перезаписью стандартных.
 * 
 * Оптимизировано для минимального размера system prompt:
 * - Убраны description из параметров (экономия ~100 токенов)
 * - ctx_stats закомментирован (экономия ~50-80 токенов)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import type { MemoryDatabase } from "../memory/database.js";
import { executeCtxBash, type CtxBashArgs } from "../context-tools/ctx-bash.js";
import { executeCtxRead, type CtxReadArgs } from "../context-tools/ctx-read.js";
import { executeCtxSearch, type CtxSearchArgs } from "../context-tools/ctx-search.js";
// import { executeCtxStats } from "../context-tools/ctx-stats.js";  // ← Закомментировано для экономии токенов

/** Общий renderResult для инструментов с сохранением в БД */
function renderSavedToDb(result: any, { expanded, isPartial }: any, theme: any, label: string) {
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  
  if (isPartial) {
    return new Text(theme.fg("accent", "⠙") + ` ${label}…`, 0, 0);
  }
  
  // Если текст пустой
  if (!text || text.length === 0) {
    return new Text(theme.fg("success", "✓") + " done (empty)", 0, 0);
  }
  
  // Получаем первую строку для превью
  const firstLine = text.split("\n").find((l: string) => l.trim()) || "";
  const preview = firstLine.slice(0, 100);
  
  // Если результат малый (< 200 символов) — показываем полностью, но с возможностью свернуть
  if (text.length < 200) {
    if (expanded) {
      return new Text(theme.fg("success", "✓ done\n") + theme.fg("dim", text), 0, 0);
    } else {
      return new Text(theme.fg("success", "✓ done") + theme.fg("dim", ` — ${preview}`), 0, 0);
    }
  }
  
  // Для больших результатов с "💾 Полный вывод сохранён"
  if (text.includes("💾 Полный вывод сохранён") || text.includes("💾 Полное содержимое файла сохранено")) {
    const summaryMatch = text.match(/^(.*?)\n\n💾/s);
    const summary = summaryMatch ? summaryMatch[1] : text.slice(0, 200);
    
    if (expanded) {
      return new Text(theme.fg("success", "✓ saved to DB\n\n") + theme.fg("dim", summary), 0, 0);
    } else {
      const summaryFirstLine = summary.split("\n").find((l: string) => l.trim()) || "";
      return new Text(theme.fg("success", "✓ saved to DB") + theme.fg("dim", ` — ${summaryFirstLine.slice(0, 80)}`), 0, 0);
    }
  }
  
  // Для остальных больших результатов
  if (expanded) {
    return new Text(theme.fg("success", "✓ done\n\n") + theme.fg("dim", text.slice(0, 500)), 0, 0);
  } else {
    return new Text(theme.fg("success", "✓ done") + theme.fg("dim", ` — ${preview}`), 0, 0);
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
      command: Type.String(),  // ← Убрано description
      timeout: Type.Optional(Type.Number()),  // ← Убрано description
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
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
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
      path: Type.String(),  // ← Убрано description
      offset: Type.Optional(Type.Number()),  // ← Убрано description
      limit: Type.Optional(Type.Number()),  // ← Убрано description
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
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
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
      pattern: Type.String(),  // ← Убрано description
      path: Type.Optional(Type.String()),  // ← Убрано description
      options: Type.Optional(Type.String()),  // ← Убрано description
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
        const command = `grep ${options} --exclude-dir=.git "${params.pattern}" ${searchPath} 2>/dev/null || true`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
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
      pattern: Type.String(),  // ← Убрано description
      path: Type.Optional(Type.String()),  // ← Убрано description
      limit: Type.Optional(Type.Number()),  // ← Убрано description
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
        const command = `find ${searchPath} -not -path '*/.git/*' -name "${params.pattern}" -type f 2>/dev/null | head -n ${limit}`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
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
      path: Type.Optional(Type.String()),  // ← Убрано description
      options: Type.Optional(Type.String()),  // ← Убрано description
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
        const command = `ls ${options} ${searchPath}`;
        
        const result = await executeCtxBash(
          { command, cwd: process.cwd() } as CtxBashArgs,
          memoryDb
        );
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  }));

  // ---- ctx_search ----
  pi.registerTool(defineTool({
    name: "ctx_search",
    label: "Search Context DB",
    description: "Search through saved tool outputs and file contents using full-text search (FTS5). Use query 'id:<number>' to get full output by ID.",
    promptSnippet: "Search saved outputs",
    parameters: Type.Object({
      query: Type.String(),  // ← Убрано description
      limit: Type.Optional(Type.Number()),  // ← Убрано description
    }),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("ctx_search")) + " " + theme.fg("dim", args.query.slice(0, 50)), 0, 0);
    },
    
    renderResult(result, { isPartial }, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      if (isPartial) {
        return new Text(theme.fg("accent", "⠙") + " searching…", 0, 0);
      }
      const match = text.match(/Found (\d+) result/);
      const count = match ? match[1] : "?";
      return new Text(theme.fg("success", "✓") + ` found ${count} results`, 0, 0);
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const result = executeCtxSearch(params as CtxSearchArgs, memoryDb);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  }));

  // ========================================================================
  // ctx_stats — ЗАКОММЕНТИРОВАНО для экономии ~50-80 токенов в system prompt
  // Статистика доступна через команду /memory-stats
  // ========================================================================
  /*
  pi.registerTool(defineTool({
    name: "ctx_stats",
    label: "Context DB Stats",
    description: "Show statistics about saved data in context database.",
    promptSnippet: "Show context DB statistics",
    parameters: Type.Object({}),
    
    renderCall(args, theme) {
      return new Text("▸ " + theme.fg("toolTitle", theme.bold("ctx_stats")), 0, 0);
    },
    
    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("accent", "⠙") + " getting stats…", 0, 0);
      }
      return new Text(theme.fg("success", "✓") + " stats", 0, 0);
    },
    
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      try {
        const result = executeCtxStats(memoryDb);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  }));
  */
}
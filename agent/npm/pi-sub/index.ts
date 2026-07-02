/**
 * pi-agents — Sub-agents extension with command-based control + memory database.
 *
 * Phase 1: Memory database integration (SQLite + FTS5)
 * Phase 2C: Tool override — standard tools replaced with context-preserved versions
 * Phase 4A: Session memory — automatic fact extraction
 * Phase 4B: Inject relevant facts into subagent prompts
 * Phase 4C: Custom system prompt with memory policy
 */

import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentManager } from "./agent-manager.js";
import { registerAgents } from "./agent-types.js";
import { loadCustomAgents } from "./custom-agents.js";
import {
  type AgentActivity,
  AgentWidget,
  type UICtx,
} from "./ui/agent-widget.js";
import { MemoryDatabase } from "./memory/database.js";
import {
  getSessionMemory,
  type SessionMemory,
} from "./memory/session-memory.js";
import type { PiSubContext } from "./types/pi-sub-context.js";
import { registerRenderers } from "./renderers/message-renderers.js";
import { registerTools } from "./tools/register-tools.js";
import { registerAgentCommands } from "./commands/agent-commands.js";
import { registerMemoryCommands } from "./commands/memory-commands.js";
import { registerAgentsMenu } from "./commands/agents-menu.js";

// ============================================================================
// Вспомогательные функции (вынесены наружу для чистоты)
// ============================================================================

/**
 * Получить путь к pi-coding-agent динамически.
 * Использует createRequire для ES-модулей.
 */
function getPiCodingAgentPath(): string {
  try {
    const require = createRequire(import.meta.url);
    const piPackagePath =
      require.resolve("@earendil-works/pi-coding-agent/package.json");
    return dirname(piPackagePath);
  } catch {
    // Fallback на хардкод если не удалось найти
    return "/home/igorp/.nvm/versions/node/v22.23.0/lib/node_modules/@earendil-works/pi-coding-agent";
  }
}

/**
 * Построить кастомный системный промпт с memory policy.
 * Экономия: ~1700 токенов по сравнению со стандартным промптом pi-coding-agent.
 */
function buildCustomPrompt(piPath: string): string {
  return `You are an expert coding assistant in pi with persistent memory across sessions.

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
}

// ============================================================================
// Главная функция расширения
// ============================================================================

export default function (pi: ExtensionAPI) {
  // ==========================================================================
  // Инициализация Memory Database
  // ==========================================================================
  let memoryDb: MemoryDatabase;
  try {
    memoryDb = MemoryDatabase.getInstance();
    const stats = memoryDb.getStats();
    console.log(
      `[pi-sub] 📦 Memory database initialized. ` +
        `Tool outputs: ${stats.toolOutputs}, ` +
        `Subagent results: ${stats.subagentResults}, ` +
        `Session facts: ${stats.sessionFacts}, ` +
        `Size: ${stats.dbSizeMb.toFixed(2)} MB`,
    );
  } catch (err) {
    console.error(`[pi-sub] ❌ Failed to initialize memory database:`, err);
    memoryDb = null as any;
  }

  // ==========================================================================
  // ФАЗА 4A: Инициализация Session Memory
  // ==========================================================================
  let sessionMemory: SessionMemory | null = null;
  try {
    if (memoryDb) {
      sessionMemory = getSessionMemory(memoryDb);

      // Генерируем уникальный ID сессии при старте расширения
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionMemory.setSessionId(sessionId);

      console.log(`[pi-sub] 🧠 Session memory initialized (ID: ${sessionId})`);
    }
  } catch (err) {
    console.error(`[pi-sub] ❌ Failed to initialize session memory:`, err);
  }

  // ==========================================================================
  // Рендереры
  // ==========================================================================
  registerRenderers(pi);

  // ==========================================================================
  // Reload custom agents
  // ==========================================================================
  const reloadCustomAgents = () => {
    const userAgents = loadCustomAgents(process.cwd());
    registerAgents(userAgents);
  };
  reloadCustomAgents();

  // ==========================================================================
  // Agent Manager
  // ==========================================================================
  const agentActivity = new Map<string, AgentActivity>();
  const manager = new AgentManager(
    (record) => {
      const isError =
        record.status === "error" ||
        record.status === "stopped" ||
        record.status === "aborted";
      const durationMs = record.completedAt
        ? record.completedAt - record.startedAt
        : Date.now() - record.startedAt;

      pi.events.emit(isError ? "subagents:failed" : "subagents:completed", {
        id: record.id,
        type: record.type,
        description: record.description,
        result: record.result,
        error: record.error,
        status: record.status,
        toolUses: record.toolUses,
        durationMs,
      });

      pi.appendEntry("subagents:record", {
        id: record.id,
        type: record.type,
        description: record.description,
        status: record.status,
        result: record.result,
        error: record.error,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      });

      // Автоматическая инъекция результата в контекст родителя
      if (record.result && record.status === "completed") {
        const message = `[Subagent "${record.description}" (ID: ${record.id}) completed]\n\n${record.result}`;
        pi.sendMessage(
          { customType: "subagent-result", content: message, display: true },
          { triggerTurn: true, deliverAs: "steer" },
        );
        console.log(
          `[pi-subagents] Auto-injected result from agent ${record.id} into parent context`,
        );
      }

      // Сохранение результата субагента в БД
      if (memoryDb && record.result) {
        try {
          memoryDb.saveSubagentResult({
            id: record.id,
            agentType: record.type,
            description: record.description,
            result: record.result,
            status: record.status,
            toolUses: record.toolUses,
            durationMs: record.completedAt
              ? record.completedAt - record.startedAt
              : 0,
          });
        } catch (err) {
          console.error(
            `[pi-sub] Failed to save subagent result to memory DB:`,
            err,
          );
        }
      }

      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      widget.update();
    },
    undefined,
    (record) => {
      pi.events.emit("subagents:started", {
        id: record.id,
        type: record.type,
        description: record.description,
      });
    },
    (record, info) => {
      pi.events.emit("subagents:compacted", {
        id: record.id,
        type: record.type,
        description: record.description,
        reason: info.reason,
        tokensBefore: info.tokensBefore,
        compactionCount: record.compactionCount,
      });
    },
  );

  // Expose manager via Symbol.for() global registry
  const MANAGER_KEY = Symbol.for("pi-subagents:manager");
  (globalThis as any)[MANAGER_KEY] = {
    waitForAll: () => manager.waitForAll(),
    hasRunning: () => manager.hasRunning(),
    spawn: (piRef: any, ctx: any, type: string, prompt: string, options: any) =>
      manager.spawn(piRef, ctx, type, prompt, options),
    getRecord: (id: string) => manager.getRecord(id),
  };

  pi.events.emit("subagents:ready", {});

  // Live widget
  const widget = new AgentWidget(manager, agentActivity);

  // ==========================================================================
  // Контекст для модулей
  // ==========================================================================
  const piSubContext: PiSubContext = {
    pi,
    memoryDb,
    sessionMemory,
    manager,
    widget,
    agentActivity,
    reloadCustomAgents,
  };

  // ==========================================================================
  // Регистрация инструментов
  // ==========================================================================
  registerTools(pi, memoryDb);

  // ==========================================================================
  // Регистрация команд
  // ==========================================================================
  registerAgentCommands(piSubContext);
  registerMemoryCommands(piSubContext);
  registerAgentsMenu(piSubContext);

  // ==========================================================================
  // События сессии
  // ==========================================================================
  pi.on("session_start", async (event: any, ctx) => {
    widget.setUICtx(ctx.ui as UICtx);
    manager.clearCompleted(true);

    // ФАЗА 4A: Обновляем ID сессии при старте новой сессии
    if (sessionMemory) {
      const newSessionId =
        event?.sessionId ||
        `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionMemory.setSessionId(newSessionId);
      console.log(`[pi-sub] 🧠 Session ID updated: ${newSessionId}`);
    }
  });

  pi.on("session_before_switch", () => {
    manager.clearCompleted(true);
  });

  pi.on("session_shutdown", async () => {
    manager.abortAll();
    manager.dispose();
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    widget.setUICtx(ctx.ui as UICtx);
    widget.onTurnStart();
  });

  // ==========================================================================
  // ФАЗА 2C: Ограничение размера данных от инструментов
  // ==========================================================================
  pi.on("tool_result", async (event: any, ctx) => {
    // Ограничиваем размер данных чтобы предотвратить переполнение контекста
    const MAX_OUTPUT_SIZE = 50000; // 50KB максимум

    if (!event?.result?.content) return;

    let modified = false;
    const newContent = event.result.content.map((block: any) => {
      if (
        block.type === "text" &&
        block.text &&
        block.text.length > MAX_OUTPUT_SIZE
      ) {
        modified = true;
        const truncated = block.text.slice(0, MAX_OUTPUT_SIZE);
        return {
          ...block,
          text:
            truncated +
            `\n\n[TRUNCATED: output exceeded ${MAX_OUTPUT_SIZE} chars. Full output saved to memory database.]`,
        };
      }
      return block;
    });

    if (modified) {
      console.log(
        `[pi-sub] ✂️ Truncated large tool output to prevent context overflow`,
      );
      return {
        ...event.result,
        content: newContent,
      };
    }

    return undefined;
  });

  // ==========================================================================
  // ФАЗА 4A: Автоматическое извлечение фактов перед сжатием контекста
  // ==========================================================================
  pi.on("session_before_compact", async (event: any, ctx) => {
    if (!sessionMemory) return;

    try {
      let messages: any[] = [];

      if (ctx?.sessionManager?.getBranch) {
        messages = ctx.sessionManager.getBranch() || [];
      } else if (event?.messages) {
        messages = event.messages;
      } else if (ctx?.messages) {
        messages = ctx.messages;
      }

      if (messages.length === 0) {
        console.log(`[pi-sub] 🧠 No messages to extract facts from`);
        return;
      }

      const count = sessionMemory.extractAndSaveFacts(messages);
      if (count > 0) {
        console.log(`[pi-sub] 🧠 Extracted ${count} facts before compaction`);
      }
    } catch (err) {
      console.error(`[pi-sub] ❌ Failed to extract facts:`, err);
    }
  });

  // ==========================================================================
  // ФАЗА 4C: Кастомный системный промпт с memory policy
  // ==========================================================================
  pi.on("before_agent_start", async (event: any, ctx) => {
    const piPath = getPiCodingAgentPath();
    const customPrompt = buildCustomPrompt(piPath);

    console.log(`[pi-sub] 📝 Using custom system prompt (pi path: ${piPath})`);
    return { systemPrompt: customPrompt };
  });
}

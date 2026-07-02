/**
 * pi-agents — Sub-agents extension with command-based control + memory database.
 * 
 * Phase 1: Memory database integration (SQLite + FTS5)
 * Phase 2C: Tool override — standard tools replaced with context-preserved versions
 * Phase 4A: Session memory — automatic fact extraction
 * Phase 4B: Inject relevant facts into subagent prompts
 * Phase 4C: Policy-only mode — inject memory policy into system prompt
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentManager } from "./agent-manager.js";
import { registerAgents } from "./agent-types.js";
import { loadCustomAgents } from "./custom-agents.js";
import { type AgentActivity, AgentWidget, type UICtx } from "./ui/agent-widget.js";
import { MemoryDatabase } from "./memory/database.js";
import { getSessionMemory, type SessionMemory } from "./memory/session-memory.js";
import type { PiSubContext } from "./types/pi-sub-context.js";
import { registerRenderers } from "./renderers/message-renderers.js";
import { registerTools } from "./tools/register-tools.js";
import { registerAgentCommands } from "./commands/agent-commands.js";
import { registerMemoryCommands } from "./commands/memory-commands.js";
import { registerAgentsMenu } from "./commands/agents-menu.js";

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
      `Size: ${stats.dbSizeMb.toFixed(2)} MB`
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
      const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
      const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
      
      pi.events.emit(isError ? "subagents:failed" : "subagents:completed", {
        id: record.id, type: record.type, description: record.description,
        result: record.result, error: record.error, status: record.status,
        toolUses: record.toolUses, durationMs,
      });
      
      pi.appendEntry("subagents:record", {
        id: record.id, type: record.type, description: record.description,
        status: record.status, result: record.result, error: record.error,
        startedAt: record.startedAt, completedAt: record.completedAt,
      });
      
      // ========================================================================
      // Инъекция результата в контекст родителя или показ в UI
      // ========================================================================
      if (record.result && record.status === "completed") {
        if (record.noInject) {
          // Режим no-inject: НЕ инжектируем в родителя, но показываем в UI
          console.log(`[pi-sub] 🔇 Agent ${record.id}: no-inject mode — showing result in UI only`);
          
          const message = `[Agent ${record.id}]\n${record.result}`;
          pi.sendMessage(
            { customType: "subagent-result-silent", content: message, display: true },
            { triggerTurn: false, deliverAs: "info" }
          );
        } else {
          // Обычный режим: инжектируем в контекст родителя
          const message = `[Subagent "${record.description}" (ID: ${record.id}) completed]\n\n${record.result}`;
          pi.sendMessage(
            { customType: "subagent-result", content: message, display: true },
            { triggerTurn: true, deliverAs: "steer" }
          );
          console.log(`[pi-subagents] Auto-injected result from agent ${record.id} into parent context`);
        }
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
            durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
          });
          console.log(`[pi-sub] 💾 Saved subagent result to DB (${record.result.length} chars)`);
        } catch (err) {
          console.error(`[pi-sub] Failed to save subagent result to memory DB:`, err);
        }
      }
      
      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      widget.update();
    },
    undefined,
    (record) => {
      pi.events.emit("subagents:started", {
        id: record.id, type: record.type, description: record.description,
      });
    },
    (record, info) => {
      pi.events.emit("subagents:compacted", {
        id: record.id, type: record.type, description: record.description,
        reason: info.reason, tokensBefore: info.tokensBefore,
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
  console.log(`[pi-sub] 📦 Registering tools with memoryDb: ${!!memoryDb}`);
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
      const newSessionId = event?.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    const MAX_OUTPUT_SIZE = 5000; // 5KB максимум
    
    if (!event?.result?.content) return;
    
    let modified = false;
    const newContent = event.result.content.map((block: any) => {
      if (block.type === "text" && block.text && block.text.length > MAX_OUTPUT_SIZE) {
        modified = true;
        const truncated = block.text.slice(0, MAX_OUTPUT_SIZE);
        return {
          ...block,
          text: truncated + `\n\n[TRUNCATED: output exceeded ${MAX_OUTPUT_SIZE} chars. Full output saved to memory database.]`,
        };
      }
      return block;
    });
    
    if (modified) {
      console.log(`[pi-sub] ✂️ Truncated large tool output to prevent context overflow`);
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
  // ФАЗА 4C: Policy-only режим — инжектируем политику памяти в system prompt
  // ==========================================================================
  pi.on("before_agent_start", async (event: any, ctx) => {
    // Добавляем короткую политику памяти в system prompt
    // Это ~50 токенов вместо инжекта всех фактов
    const memoryPolicy = `
<memory-policy>
You have access to persistent memory across sessions:
- Use ctx_search to find relevant context from previous sessions
- Memory contains decisions, lessons, preferences, architecture notes, and API details
- Use memory context when it helps, but repo/tool evidence wins
</memory-policy>`;

    // Модифицируем system prompt
    if (event?.systemPrompt) {
      console.log(`[pi-sub] 📝 Injected memory policy into system prompt`);
      return {
        systemPrompt: event.systemPrompt + memoryPolicy,
      };
    }
    
    return undefined;
  });
}
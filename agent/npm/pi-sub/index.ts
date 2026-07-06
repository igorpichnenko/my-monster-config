/**
 * pi-sub — Sub-agents extension (lifecycle management only).
 *
 * Зависит от:
 * - pi-memory (для SessionMemory)
 * - pi-context-tools (для registerContextTools)
 * 
 * Замечание: инициализация MemoryDatabase — ответственность pi-memory.
 */

import { AgentManager } from "./agent-manager.js";
import { type AgentRecord } from "./types.js";
import { type CompactionInfo } from "./agent-runner.js";
import { registerAgents } from "./agent-types.js";
import { loadCustomAgents } from "./custom-agents.js";
import { AgentWidget, type UICtx } from "./ui/agent-widget.js";
import { MemoryDatabase, getSessionMemory, resetSessionMemory, type SessionMemory } from "pi-memory";
import type { PiSubContext } from "./types/pi-sub-context.js";
import { registerRenderers } from "./renderers/message-renderers.js";
import { registerAgentCommands } from "./commands/agent-commands.js";

import { registerAgentsMenu } from "./commands/agents-menu.js";
import { applyAndEmitLoaded } from "./settings.js";
import type { SettingsAppliers, SettingsEmit } from "./settings.js";
import { registerSessionEvents } from "./session-handler.js";
import { buildCustomPrompt } from "./custom-prompt.js";

export default function (pi: any) {
  // ==========================================================================
  // 1. Получаем БД (pi-memory уже инициализировал singleton)
  // ==========================================================================
  let memoryDb = MemoryDatabase.getInstance();

  // ==========================================================================
  // 2. Session Memory (уникальная сессия для извлечения фактов)
  // ==========================================================================
  let sessionMemory: SessionMemory | null = null;
  try {
    sessionMemory = getSessionMemory(memoryDb);
    sessionMemory.setSessionId(`session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const projectRoot = MemoryDatabase.getCurrentProjectRoot();
    if (projectRoot) sessionMemory.setProjectPath(projectRoot);
    console.log(`[pi-sub] 🧠 Session memory initialized (Project: ${projectRoot})`);
  } catch (err) {
    console.error(`[pi-sub] ❌ Failed to initialize session memory:`, err);
  }

  // ==========================================================================
  // 3. Загрузка агентов
  // ==========================================================================
  const reloadCustomAgents = () => {
    registerAgents(loadCustomAgents(process.cwd()));
  };
  reloadCustomAgents();

  // ==========================================================================
  // 4. Agent Manager (core — обработка жизненного цикла субагентов)
  // ==========================================================================
  const agentActivity = new Map<string, any>();
  const manager = new AgentManager(
    // onComplete
    (record) => {
      const isError = record.status === "error" || record.status === "stopped" || record.status === "aborted";
      const durationMs = record.completedAt ? record.completedAt - record.startedAt : Date.now() - record.startedAt;
      pi.events.emit(isError ? "subagents:failed" : "subagents:completed", { ...record, durationMs });
      pi.appendEntry("subagents:record", { ...record });

      // Инъекция результата в контекст родителя или показ в UI
      if (record.result && record.status === "completed") {
        const message = `[Subagent "${record.description}" (ID: ${record.id}) completed]\n\n${record.result}`;
        pi.sendMessage(
          { customType: record.noInject ? "subagent-result-silent" : "subagent-result", content: message, display: true },
          { triggerTurn: !record.noInject, deliverAs: "steer" },
        );
      }

      // Сохранение результата субагента в БД
      if (memoryDb && record.result) {
        try {
          memoryDb.saveSubagentResult({
            id: record.id, agentType: record.type, description: record.description,
            result: record.result, status: record.status, toolUses: record.toolUses,
            durationMs: record.completedAt ? record.completedAt - record.startedAt : 0,
          });
        } catch (err) { console.error(`[pi-sub] ❌ Failed to save subagent result:`, err); }
      }

      agentActivity.delete(record.id);
      widget.markFinished(record.id);
      widget.update();
    },
    undefined,  // maxConcurrent — используем дефолт
    // onStart
    (record: AgentRecord) => { pi.events.emit("subagents:started", { id: record.id, type: record.type, description: record.description }); },
    // onCompact
   (record: AgentRecord, info: CompactionInfo) => {
  // v14: Защита от undefined info
  if (!info) {
    console.warn(`[pi-sub] ⚠️ onCompact called with undefined info for agent ${record.id}`);
    return;
  }
  
  if (memoryDb && info.summary && info.tokensBefore > 0) {
    try {
      const keywordsForSave: Array<{ keyword: string; category: "file" | "decision" | "lesson" }> = [];
      if (info.meta) {
        for (const file of info.meta.keyFiles.slice(0, 10)) keywordsForSave.push({ keyword: file, category: "file" });
        for (const d of info.meta.keyDecisions.slice(0, 5)) keywordsForSave.push({ keyword: d, category: "decision" });
        for (const l of info.meta.keyLessons.slice(0, 5)) keywordsForSave.push({ keyword: l, category: "lesson" });
      }
      memoryDb.compaction.saveSummaryWithKeywords({
        summary: { 
          sessionId: sessionMemory?.getSessionId() || "unknown", 
          reason: info.reason ?? "threshold", 
          tokensBefore: info.tokensBefore, 
          summary: info.summary, 
          detailedSummary: info.detailedSummary || "" 
        },
        keywords: keywordsForSave,
      });
    } catch (err) { 
      console.error(`[pi-sub] Failed to save compaction summary:`, err); 
    }
  }
  
  // v14: Используем optional chaining для защиты
  pi.events.emit("subagents:compacted", { 
    id: record.id, 
    type: record.type, 
    description: record.description, 
    reason: info?.reason ?? "threshold", 
    tokensBefore: info?.tokensBefore ?? 0, 
    compactionCount: record.compactionCount 
  });
},
  );

  // ==========================================================================
  // 5. Global registry (другие расширения используют для доступа к менеджеру)
  // ==========================================================================
  const MANAGER_KEY = Symbol.for("pi-subagents:manager");
  (globalThis as any)[MANAGER_KEY] = {
    waitForAll: () => manager.waitForAll(),
    hasRunning: () => manager.hasRunning(),
    spawn: (piRef: any, ctx: any, type: string, prompt: string, options: any) => manager.spawn(piRef, ctx, type, prompt, options),
    getRecord: (id: string) => manager.getRecord(id),
  };
  pi.events.emit("subagents:ready", {});

  // ==========================================================================
  // 6. Widget
  // ==========================================================================
  const widget = new AgentWidget(manager, agentActivity);

  // ==========================================================================
  // 7. Контекст для модулей
  // ==========================================================================
  const piSubContext: PiSubContext = { pi, memoryDb, sessionMemory, manager, widget, agentActivity, reloadCustomAgents };

  // ==========================================================================
  // 8. Регистрация команд и рендереров
  // ==========================================================================
  registerRenderers(pi);
  registerAgentCommands(piSubContext);
  registerAgentsMenu(piSubContext);

  // ==========================================================================
  // 10. Settings
  // ==========================================================================
  const appliers: SettingsAppliers = {
    setMaxConcurrent: (n) => manager.setMaxConcurrent(n),
    setDefaultMaxTurns: (n) => {},
    setGraceTurns: (n) => {},
    setDefaultJoinMode: (mode) => {},
    setToolDescriptionMode: (mode) => {},
    setFleetView: (b) => {},
  };
  applyAndEmitLoaded(appliers, pi.events.emit.bind(pi.events));

  // ==========================================================================
  // 11. События сессии для субагентов
  // ==========================================================================
  registerSessionEvents(pi, manager, widget);

  // ==========================================================================
  // 11.5 События сессии для памяти (auto-purge, auto-consolidation)
  //         — регистрируются в pi-memory/index.ts (когда pi-memory загружен)
  // ==========================================================================

  // ==========================================================================
  // 12. Кастомный системный промпт
  // ==========================================================================
  pi.on("before_agent_start", () => buildCustomPrompt());
}

/**
 * pi-sub-context.ts — Общий контекст для всех модулей pi-sub.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "../agent-manager.js";
import type { MemoryDatabase, SessionMemory } from "pi-memory";
import type { AgentActivity } from "../ui/agent-widget.js";
import type { AgentWidget } from "../ui/agent-widget.js";

export interface PiSubContext {
  pi: ExtensionAPI;
  memoryDb: MemoryDatabase | null;
  sessionMemory: SessionMemory | null;
  manager: AgentManager;
  widget: AgentWidget;
  agentActivity: Map<string, AgentActivity>;
  reloadCustomAgents: () => void;
}
/**
 * activity-tracker.ts — Трекинг активности субагентов и вспомогательные функции.
 */

import { type AgentActivity, formatTokens } from "../ui/agent-widget.js";
import { addUsage, getLifetimeTotal, type LifetimeUsage } from "../usage.js";

export interface AgentDetails {
  displayName: string;
  description: string;
  subagentType: string;
  modelName?: string;
  tags?: string[];
  toolUses: number;
  tokens: string;
  turnCount?: number;
  maxTurns?: number;
  durationMs: number;
  status: string;
  agentId?: string;
  error?: string;
  activity?: string;
  spinnerFrame?: number;
  resultPreview?: string;
}

export function textResult(msg: string, details?: AgentDetails) {
  return { content: [{ type: "text" as const, text: msg }], details: details as any };
}

export function createActivityTracker(maxTurns?: number, onStreamUpdate?: () => void) {
  const state: AgentActivity = {
    activeTools: new Map(),
    toolUses: 0,
    turnCount: 1,
    maxTurns,
    responseText: "",
    session: undefined,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
  };

  const callbacks = {
    onToolActivity: (activity: { type: "start" | "end"; toolName: string }) => {
      if (activity.type === "start") {
        state.activeTools.set(activity.toolName + "_" + Date.now(), activity.toolName);
      } else {
        for (const [key, name] of state.activeTools) {
          if (name === activity.toolName) { state.activeTools.delete(key); break; }
        }
        state.toolUses++;
      }
      onStreamUpdate?.();
    },
    onTextDelta: (_delta: string, fullText: string) => {
      state.responseText = fullText;
      onStreamUpdate?.();
    },
    onTurnEnd: (turnCount: number) => {
      state.turnCount = turnCount;
      onStreamUpdate?.();
    },
    onSessionCreated: (session: any) => {
      state.session = session;
    },
    onAssistantUsage: (usage: { input: number; output: number; cacheWrite: number }) => {
      addUsage(state.lifetimeUsage, usage);
      onStreamUpdate?.();
    },
  };

  return { state, callbacks };
}

export function getStatusNote(status: string): string {
  switch (status) {
    case "stopped":
      return " (STOPPED BY THE USER before completion — output is partial; the task was NOT finished)";
    case "aborted":
      return " (aborted — hit the turn limit before completion; output may be incomplete)";
    case "steered":
      return " (wrapped up at the turn limit — output may be partial)";
    default:
      return "";
  }
}

export function buildDetails(
  base: Pick<AgentDetails, "displayName" | "description" | "subagentType" | "modelName" | "tags">,
  record: { toolUses: number; startedAt: number; completedAt?: number; status: string; error?: string; id?: string; session?: any; lifetimeUsage: LifetimeUsage },
  activity?: AgentActivity,
): AgentDetails {
  return {
    ...base,
    toolUses: record.toolUses,
    tokens: getLifetimeTotal(record.lifetimeUsage) > 0 ? formatTokens(getLifetimeTotal(record.lifetimeUsage)) : "",
    turnCount: activity?.turnCount,
    maxTurns: activity?.maxTurns,
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status as AgentDetails["status"],
    agentId: record.id,
    error: record.error,
  };
}

export function formatLifetimeTokens(o: { lifetimeUsage: LifetimeUsage }): string {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}
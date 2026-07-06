/**
 * session-handler.ts — События сессии для субагентов.
 * Вынесено из index.ts для чистоты.
 * 
 * Ответственность: управление жизненным циклом субагентов.
 * Память обрабатывается в pi-memory/commands/session-events.ts.
 */

import type { AgentManager } from "./agent-manager.js";
import type { AgentWidget } from "./ui/agent-widget.js";

export function registerSessionEvents(
  pi: any,
  manager: AgentManager,
  widget: AgentWidget,
): void {
  pi.on("session_start", async (event: any, ctx: any) => {
    widget.setUICtx(ctx.ui as any);
    manager.clearCompleted(true);
  });

  pi.on("session_before_switch", () => {
    manager.clearCompleted(true);
  });

  pi.on("session_shutdown", async () => {
    manager.abortAll();
    manager.dispose();
  });

  pi.on("tool_execution_start", async (_event: any, ctx: any) => {
    widget.setUICtx(ctx.ui as any);
    widget.onTurnStart();
  });
}

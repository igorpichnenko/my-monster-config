/**
 * agent-commands.ts — Команды для управления субагентами.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getAgentConfig } from "../agent-types.js";
import { resolveAgentInvocationConfig } from "../invocation-config.js";
import { getDefaultMaxTurns, normalizeMaxTurns, steerAgent } from "../agent-runner.js";
import { loadCustomAgents } from "../custom-agents.js";
import { registerAgents } from "../agent-types.js";
import { createActivityTracker, formatLifetimeTokens, getStatusNote } from "../helpers/activity-tracker.js";
import { formatDuration } from "../ui/agent-widget.js";
import type { PiSubContext } from "../types/pi-sub-context.js";

export function registerAgentCommands(ctx: PiSubContext): void {
  const { pi, manager, agentActivity, widget } = ctx;

  const reloadCustomAgents = () => {
    const userAgents = loadCustomAgents(process.cwd());
    registerAgents(userAgents);
  };

  // /agent-bg <prompt>
  pi.registerCommand("agent-bg", {
    description: "Launch subagent in background: /agent-bg [--no-inject] <prompt>",
    handler: async (argStr, cmdCtx) => {
      let prompt = argStr.trim();
      if (!prompt) {
        cmdCtx.ui.notify("Usage: /agent-bg [--no-inject] <prompt>", "warning");
        return;
      }

      // Проверяем флаг --no-inject
      let noInject = false;
      if (prompt.startsWith("--no-inject ")) {
        noInject = true;
        prompt = prompt.slice("--no-inject ".length).trim();
      } else if (prompt.startsWith("--silent ")) {
        noInject = true;
        prompt = prompt.slice("--silent ".length).trim();
      }

      if (!prompt) {
        cmdCtx.ui.notify("Usage: /agent-bg [--no-inject] <prompt>", "warning");
        return;
      }

      reloadCustomAgents();
      const subagentType = "general-purpose";
      const customConfig = getAgentConfig(subagentType);
      const resolvedConfig = resolveAgentInvocationConfig(customConfig, {});
      const effectiveMaxTurns = normalizeMaxTurns(resolvedConfig.maxTurns ?? getDefaultMaxTurns());

      const { state: bgState, callbacks: bgCallbacks } = createActivityTracker(effectiveMaxTurns);

      const id = manager.spawn(pi, cmdCtx as any, subagentType, prompt, {
        description: prompt.slice(0, 30),
        model: (cmdCtx as any).model,
        maxTurns: effectiveMaxTurns,
        isBackground: true,
        noInject,  // ← НОВОЕ
        ...bgCallbacks,
      });

      agentActivity.set(id, bgState);
      widget.ensureTimer();
      widget.update();

      const modeNote = noInject ? " (no-inject mode: result saved to DB only)" : "";
      cmdCtx.ui.notify(`Agent started: ${id}${modeNote}\nUse /agent-status ${id} to check progress.`, "info");
    },
  });

  // /agent-steer <id> <message>
  pi.registerCommand("agent-steer", {
    description: "Send message to running subagent: /agent-steer <id> <message>",
    handler: async (argStr, cmdCtx) => {
      const parts = argStr.trim().split(/\s+/);
      const id = parts[0];
      const message = parts.slice(1).join(" ");

      if (!id || !message) {
        cmdCtx.ui.notify("Usage: /agent-steer <id> <message>", "warning");
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        cmdCtx.ui.notify("Agent not found: " + id, "error");
        return;
      }
      if (record.status !== "running") {
        cmdCtx.ui.notify(`Agent is not running (status: ${record.status})`, "warning");
        return;
      }
      if (!record.session) {
        if (!record.pendingSteers) record.pendingSteers = [];
        record.pendingSteers.push(message);
        cmdCtx.ui.notify("Message queued (session not ready yet)", "info");
        return;
      }

      try {
        await steerAgent(record.session, message);
        cmdCtx.ui.notify("Message sent", "info");
      } catch (err) {
        cmdCtx.ui.notify(`Failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // /agent-result <id>
  pi.registerCommand("agent-result", {
    description: "Show subagent result: /agent-result <id>",
    handler: async (argStr, cmdCtx) => {
      const id = argStr.trim();
      if (!id) {
        cmdCtx.ui.notify("Usage: /agent-result <id>", "warning");
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        cmdCtx.ui.notify("Agent not found: " + id, "error");
        return;
      }

      if (record.status === "running") {
        cmdCtx.ui.notify("Agent is still running", "warning");
        return;
      }

      const result = record.result?.trim() || record.error || "No output";
      cmdCtx.ui.notify(`[Agent ${id}]\n${result}`, "info");
    },
  });

  // /agent-inject <id>
  pi.registerCommand("agent-inject", {
    description: "Inject subagent result into parent context: /agent-inject <id>",
    handler: async (argStr, cmdCtx) => {
      const id = argStr.trim();
      if (!id) {
        cmdCtx.ui.notify("Usage: /agent-inject <id>", "warning");
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        cmdCtx.ui.notify("Agent not found: " + id, "error");
        return;
      }

      if (record.status === "running") {
        cmdCtx.ui.notify("Agent is still running, wait for completion", "warning");
        return;
      }

      const result = record.result?.trim() || record.error || "No output";
      const message = `[Subagent "${record.description}" (ID: ${record.id}) completed]\n\n${result}`;
      
      pi.sendMessage(
        { customType: "subagent-result", content: message, display: true },
        { triggerTurn: true, deliverAs: "steer" }
      );
      
      cmdCtx.ui.notify(`Result injected into parent context for agent ${id}`, "info");
    },
  });

  // /agent-resume <id> <prompt>
  pi.registerCommand("agent-resume", {
    description: "Resume existing subagent: /agent-resume <id> <prompt>",
    handler: async (argStr, cmdCtx) => {
      const parts = argStr.trim().split(/\s+/);
      const id = parts[0];
      const prompt = parts.slice(1).join(" ");

      if (!id || !prompt) {
        cmdCtx.ui.notify("Usage: /agent-resume <id> <prompt>", "warning");
        return;
      }

      const record = manager.getRecord(id);
      if (!record) {
        cmdCtx.ui.notify("Agent not found: " + id, "error");
        return;
      }

      if (!record.session) {
        cmdCtx.ui.notify("Agent has no active session to resume", "error");
        return;
      }

      try {
        const resumedRecord = await manager.resume(id, prompt);
        if (!resumedRecord) {
          cmdCtx.ui.notify("Failed to resume agent", "error");
          return;
        }
        cmdCtx.ui.notify(`Agent ${id} resumed with new task. Use /agent-status ${id} to check progress.`, "info");
      } catch (err) {
        cmdCtx.ui.notify(`Failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // /agent-view <id>
  pi.registerCommand("agent-view", {
    description: "Watch a running agent's full response text",
    handler: async (argStr, cmdCtx) => {
      const agentId = argStr.trim();
      const agent = manager.getRecord(agentId);
      if (!agent) {
        cmdCtx.ui.notify("Agent not found: " + agentId, "error");
        return;
      }
      if (agent.status !== "running") {
        cmdCtx.ui.notify("Agent is not running (status: " + agent.status + ")", "warning");
        return;
      }

      const activity = agentActivity.get(agentId);
      if (!activity) {
        cmdCtx.ui.notify("No activity data for agent", "warning");
        return;
      }

      cmdCtx.ui.notify("Watching agent: " + agent.description + " (press Ctrl+C to stop)", "info");

      let lastLen = 0;
      const interval = setInterval(() => {
        const text = activity.responseText || "";
        if (text.length > lastLen) {
          const newPart = text.slice(lastLen);
          cmdCtx.ui.notify(newPart, "info");
          lastLen = text.length;
        }
      }, 1000);

      const checkDone = setInterval(() => {
        const updated = manager.getRecord(agentId);
        if (updated && updated.status !== "running") {
          clearInterval(interval);
          clearInterval(checkDone);
          const finalText = activity.responseText || "";
          if (finalText.length > lastLen) {
            cmdCtx.ui.notify(finalText.slice(lastLen), "info");
          }
          cmdCtx.ui.notify("Agent completed: " + updated.status, "info");
        }
      }, 500);

      setTimeout(() => {
        clearInterval(interval);
        clearInterval(checkDone);
        cmdCtx.ui.notify("Watch timed out", "warning");
      }, 300000);
    },
  });

  // /agent-status <id>
  pi.registerCommand("agent-status", {
    description: "Show agent's full response and activity",
    handler: async (argStr, cmdCtx) => {
      const agentId = argStr.trim();
      const agent = manager.getRecord(agentId);
      if (!agent) {
        cmdCtx.ui.notify("Agent not found: " + agentId, "error");
        return;
      }

      const activity = agentActivity.get(agentId);
      const lines: string[] = [
        `Agent: ${agent.description}`,
        `Type: ${agent.type}`,
        `Status: ${agent.status}`,
        `Tool uses: ${agent.toolUses}`,
        `Turns: ${activity ? activity.turnCount : 'N/A'}`,
        `Duration: ${formatDuration(agent.startedAt, agent.completedAt)}`,
      ];

      if (activity?.responseText) {
        lines.push("");
        lines.push("--- Full Response ---");
        lines.push(activity.responseText);
        lines.push("--- End ---");
      }

      if (activity?.activeTools && activity.activeTools.size > 0) {
        lines.push("");
        lines.push("Active tools:");
        for (const [key, name] of activity.activeTools) {
          lines.push(`  - ${name}`);
        }
      }

      cmdCtx.ui.notify(lines.join("\n"), "info");
    },
  });
}
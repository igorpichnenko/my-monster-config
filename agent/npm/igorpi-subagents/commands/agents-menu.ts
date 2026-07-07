/**
 * agents-menu.ts — Меню /agents и связанные функции.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import { getAgentConfig, getAvailableTypes, registerAgents } from "../agent-types.js";
import { loadCustomAgents } from "../custom-agents.js";
import { getAgentConversation, getDefaultMaxTurns, getGraceTurns, setDefaultMaxTurns, setGraceTurns } from "../agent-runner.js";
import { applyAndEmitLoaded, type SubagentsSettings, saveAndEmitChanged, type ToolDescriptionMode } from "../settings.js";
import { formatDuration, getDisplayName } from "../ui/agent-widget.js";
import type { PiSubContext } from "../types/pi-sub-context.js";

const projectAgentsDir = () => join(process.cwd(), ".pi", "agents");
const personalAgentsDir = () => join(getAgentDir(), "agents");

function findAgentFile(name: string): { path: string; location: "project" | "personal" } | undefined {
  const projectPath = join(projectAgentsDir(), `${name}.md`);
  if (existsSync(projectPath)) return { path: projectPath, location: "project" };
  const personalPath = join(personalAgentsDir(), `${name}.md`);
  if (existsSync(personalPath)) return { path: personalPath, location: "personal" };
  return undefined;
}

export function registerAgentsMenu(ctx: PiSubContext): void {
  const { pi, manager, reloadCustomAgents } = ctx;

  async function showAgentsMenu(cmdCtx: ExtensionCommandContext) {
    reloadCustomAgents();
    const allNames = getAvailableTypes();
    const agents = manager.listAgents();
    const running = agents.filter(a => a.status === "running" || a.status === "queued").length;
    const completed = agents.filter(a => a.status === "completed" || a.status === "steered").length;

    const options: string[] = [];
    if (agents.length > 0) {
      options.push(`Running agents (${agents.length}) — ${running} running, ${completed} done`);
    }
    if (allNames.length > 0) {
      options.push(`Agent types (${allNames.length})`);
    }
    options.push("Settings");

    if (allNames.length === 0 && agents.length === 0) {
      cmdCtx.ui.notify(
        "No agents found. Create specialized subagents that can be delegated to.\n\n" +
        "Each subagent has its own context window, custom system prompt, and specific tools.\n\n" +
        "Create a .pi/agents/<name>.md file to define a custom agent.",
        "info",
      );
    }

    const choice = await cmdCtx.ui.select("Agents", options);
    if (!choice) return;

    if (choice.startsWith("Running agents (")) {
      await showRunningAgents(cmdCtx);
      await showAgentsMenu(cmdCtx);
    } else if (choice.startsWith("Agent types (")) {
      await showAllAgentsList(cmdCtx);
      await showAgentsMenu(cmdCtx);
    } else if (choice === "Settings") {
      await showSettings(cmdCtx);
      await showAgentsMenu(cmdCtx);
    }
  }

  async function showAllAgentsList(cmdCtx: ExtensionCommandContext) {
    const allNames = getAvailableTypes();
    if (allNames.length === 0) {
      cmdCtx.ui.notify("No agents.", "info");
      return;
    }

    const entries = allNames.map(name => {
      const cfg = getAgentConfig(name);
      return { name, desc: cfg?.description ?? name };
    });

    const options = entries.map(({ name, desc }) => `${name}: ${desc}`);
    const choice = await cmdCtx.ui.select("Agent types", options);
    if (!choice) return;

    const agentName = choice.split(":")[0].trim();
    if (getAgentConfig(agentName)) {
      await showAgentDetail(cmdCtx, agentName);
      await showAllAgentsList(cmdCtx);
    }
  }

  async function showRunningAgents(cmdCtx: ExtensionCommandContext) {
    const agents = manager.listAgents();
    if (agents.length === 0) {
      cmdCtx.ui.notify("No agents.", "info");
      return;
    }

    const options = agents.map(a => {
      const dn = getDisplayName(a.type);
      const dur = formatDuration(a.startedAt, a.completedAt);
      return `${dn} (${a.description}) · ${a.toolUses} tools · ${a.status} · ${dur}`;
    });

    const choice = await cmdCtx.ui.select("Running agents", options);
    if (!choice) return;

    const idx = options.indexOf(choice);
    if (idx < 0) return;
    const record = agents[idx];

    if (record.session) {
      const conversation = getAgentConversation(record.session);
      cmdCtx.ui.notify(`Agent: ${getDisplayName(record.type)} (${record.description})\n\n${conversation}`, "info");
    } else {
      cmdCtx.ui.notify(`Agent "${record.description}" is ${record.status} — no session available.`, "info");
    }

    await showRunningAgents(cmdCtx);
  }

  async function showAgentDetail(cmdCtx: ExtensionCommandContext, name: string) {
    const cfg = getAgentConfig(name);
    if (!cfg) {
      cmdCtx.ui.notify(`Agent config not found for "${name}".`, "warning");
      return;
    }

    const file = findAgentFile(name);
    const isDefault = cfg.isDefault === true;
    const disabled = cfg.enabled === false;

    let menuOptions: string[];
    if (disabled && file) {
      menuOptions = isDefault ? ["Enable", "Edit", "Reset to default", "Delete", "Back"] : ["Enable", "Edit", "Delete", "Back"];
    } else if (isDefault && !file) {
      menuOptions = ["Disable", "Back"];
    } else if (isDefault && file) {
      menuOptions = ["Edit", "Disable", "Reset to default", "Delete", "Back"];
    } else {
      menuOptions = ["Edit", "Disable", "Delete", "Back"];
    }

    const choice = await cmdCtx.ui.select(name, menuOptions);
    if (!choice || choice === "Back") return;

    if (choice === "Edit" && file) {
      const content = readFileSync(file.path, "utf-8");
      const edited = await cmdCtx.ui.editor(`Edit ${name}`, content);
      if (edited !== undefined && edited !== content) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(file.path, edited, "utf-8");
        reloadCustomAgents();
        cmdCtx.ui.notify(`Updated ${file.path}`, "info");
      }
    } else if (choice === "Delete") {
      if (file) {
        const confirmed = await cmdCtx.ui.confirm("Delete agent", `Delete ${name} from ${file.location} (${file.path})?`);
        if (confirmed) {
          unlinkSync(file.path);
          reloadCustomAgents();
          cmdCtx.ui.notify(`Deleted ${file.path}`, "info");
        }
      }
    } else if (choice === "Reset to default" && file) {
      const confirmed = await cmdCtx.ui.confirm("Reset to default", `Delete override ${file.path} and restore embedded default?`);
      if (confirmed) {
        unlinkSync(file.path);
        reloadCustomAgents();
        cmdCtx.ui.notify(`Restored default ${name}`, "info");
      }
    } else if (choice === "Disable") {
      await disableAgent(cmdCtx, name);
    } else if (choice === "Enable") {
      await enableAgent(cmdCtx, name);
    }
  }

  async function disableAgent(cmdCtx: ExtensionCommandContext, name: string) {
    const file = findAgentFile(name);
    if (file) {
      const content = readFileSync(file.path, "utf-8");
      if (content.includes("\nenabled: false\n")) {
        cmdCtx.ui.notify(`${name} is already disabled.`, "info");
        return;
      }
      const updated = content.replace(/^---\n/, "---\nenabled: false\n");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(file.path, updated, "utf-8");
      reloadCustomAgents();
      cmdCtx.ui.notify(`Disabled ${name} (${file.path})`, "info");
      return;
    }

    const location = await cmdCtx.ui.select("Choose location", ["Project (.pi/agents/)", `Personal (${personalAgentsDir()})`]);
    if (!location) return;

    const targetDir = location.startsWith("Project") ? projectAgentsDir() : personalAgentsDir();
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${name}.md`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(targetPath, "---\nenabled: false\n---\n", "utf-8");
    reloadCustomAgents();
    cmdCtx.ui.notify(`Disabled ${name} (${targetPath})`, "info");
  }

  async function enableAgent(cmdCtx: ExtensionCommandContext, name: string) {
    const file = findAgentFile(name);
    if (!file) return;

    const content = readFileSync(file.path, "utf-8");
    const updated = content.replace(/^(---\n)enabled: false\n/, "$1");
    const { writeFileSync } = await import("node:fs");

    if (updated.trim() === "---\n---" || updated.trim() === "---\n---\n") {
      unlinkSync(file.path);
      reloadCustomAgents();
      cmdCtx.ui.notify(`Enabled ${name} (removed ${file.path})`, "info");
    } else {
      writeFileSync(file.path, updated, "utf-8");
      reloadCustomAgents();
      cmdCtx.ui.notify(`Enabled ${name} (${file.path})`, "info");
    }
  }

  function snapshotSettings(): SubagentsSettings {
    return {
      maxConcurrent: manager.getMaxConcurrent(),
      defaultMaxTurns: getDefaultMaxTurns() ?? 0,
      graceTurns: getGraceTurns(),
      defaultJoinMode: "smart",
      toolDescriptionMode: "compact",
    };
  }

  async function showSettings(cmdCtx: ExtensionCommandContext) {
    function buildItems(): SettingItem[] {
      const mc = manager.getMaxConcurrent();
      const dmt = getDefaultMaxTurns() ?? 0;
      const gt = getGraceTurns();

      return [
        {
          id: "maxConcurrent",
          label: "Max concurrency",
          description: "Max concurrent background agents (Enter to type)",
          currentValue: String(mc),
          values: [String(mc)],
        },
        {
          id: "defaultMaxTurns",
          label: "Default max turns",
          description: "Default max turns before wrap-up (0 = unlimited, Enter to type)",
          currentValue: String(dmt),
          values: [String(dmt)],
        },
        {
          id: "graceTurns",
          label: "Grace turns",
          description: "Grace turns after wrap-up steer (Enter to type)",
          currentValue: String(gt),
          values: [String(gt)],
        },
      ];
    }

    function applyValue(id: string, value: string) {
      if (id === "maxConcurrent") {
        const n = parseInt(value, 10);
        if (n >= 1) { manager.setMaxConcurrent(n); notifyApplied(cmdCtx, `Max concurrency set to ${n}`); }
      } else if (id === "defaultMaxTurns") {
        const n = parseInt(value, 10);
        if (n === 0) { setDefaultMaxTurns(undefined); notifyApplied(cmdCtx, "Default max turns set to unlimited"); }
        else if (n >= 1) { setDefaultMaxTurns(n); notifyApplied(cmdCtx, `Default max turns set to ${n}`); }
      } else if (id === "graceTurns") {
        const n = parseInt(value, 10);
        if (n >= 1) { setGraceTurns(n); notifyApplied(cmdCtx, `Grace turns set to ${n}`); }
      }
    }

    function notifyApplied(c: ExtensionCommandContext, successMsg: string) {
      const { message, level } = saveAndEmitChanged(
        snapshotSettings(),
        successMsg,
        (event, payload) => pi.events.emit(event, payload),
      );
      c.ui.notify(message, level);
    }

    let currentIndex = 0;

    const result = await cmdCtx.ui.custom<string | undefined>((_tui, _theme, _kb, done) => {
      const items = buildItems();
      const list = new SettingsList(items, items.length + 2, getSettingsListTheme(), (id, newValue) => applyValue(id, newValue), () => done(undefined));
      const container = new Container();
      container.addChild(new Text("⚙  Subagent Settings", 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(list);
      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, "up")) currentIndex = Math.max(0, currentIndex - 1);
          else if (matchesKey(data, "down")) currentIndex = Math.min(items.length - 1, currentIndex + 1);
          if (matchesKey(data, Key.enter) && (items[currentIndex].id === "maxConcurrent" || items[currentIndex].id === "defaultMaxTurns" || items[currentIndex].id === "graceTurns")) {
            done(items[currentIndex].id);
            return;
          }
          list.handleInput?.(data);
        },
      };
    });

    if (result && (result === "maxConcurrent" || result === "defaultMaxTurns" || result === "graceTurns")) {
      const id = result;
      const current = result === "maxConcurrent"
        ? String(manager.getMaxConcurrent())
        : result === "defaultMaxTurns"
          ? String(getDefaultMaxTurns() ?? 0)
          : String(getGraceTurns());
      const label = result === "maxConcurrent"
        ? "Max concurrency (1+)"
        : result === "defaultMaxTurns"
          ? "Default max turns (0 = unlimited)"
          : "Grace turns (1+)";
      let input: string | undefined = await cmdCtx.ui.input(label, current);
      while (input != null) {
        const trimmed = input.trim();
        const n = Number(trimmed);
        if (trimmed !== "" && Number.isInteger(n)) {
          applyValue(result, String(n));
          await showSettings(cmdCtx);
          return;
        }
        input = await cmdCtx.ui.input(label, trimmed);
      }
    }
  }

  pi.registerCommand("agents", {
    description: "Manage agents",
    handler: async (_args, cmdCtx) => { await showAgentsMenu(cmdCtx); },
  });
}
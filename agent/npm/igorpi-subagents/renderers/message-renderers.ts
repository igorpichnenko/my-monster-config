/**
 * message-renderers.ts — Кастомные рендереры сообщений.
 */

import type { ExtensionAPI, MessageRenderOptions, Theme } from "@earendil-works/pi-coding-agent";

import { Text } from "@earendil-works/pi-tui";
import {
  formatMs,
  formatTokens,
  formatTurns,
} from "../ui/agent-widget.js";
import type { NotificationDetails } from "../types.js";

export function registerRenderers(pi: ExtensionAPI): void {
  // Subagent result renderer
  pi.registerMessageRenderer("subagent-result", (message: { content: unknown }, _opts: MessageRenderOptions, theme: Theme) => {
    return new Text(
      theme.fg("text", `🤖 [Subagent Result] ${String(message.content)}`),
      0,
      0
    );
  });

  // Silent subagent result renderer (для no-inject режима)
  pi.registerMessageRenderer("subagent-result-silent", (message, _opts, theme) => {
    return new Text(
      theme.fg("dim", `🔇 [Subagent Result - Silent] ${String(message.content)}`),
      0,
      0
    );
  });

  // Subagent notification renderer
  pi.registerMessageRenderer<NotificationDetails>(
    "subagent-notification",
    (message, { expanded }, theme) => {
      const d = message.details;
      if (!d) return undefined;

      function renderOne(d: NotificationDetails): string {
        const isError = d.status === "error" || d.status === "stopped" || d.status === "aborted";
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const statusText = isError ? d.status
          : d.status === "steered" ? "completed (steered)"
          : "completed";

        let line = `${icon} ${theme.bold(d.description)} ${theme.fg("dim", statusText)}`;

        const parts: string[] = [];
        if (d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
        if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
        if (d.totalTokens > 0) parts.push(formatTokens(d.totalTokens));
        if (d.durationMs > 0) parts.push(formatMs(d.durationMs));

        if (parts.length) {
          line += "\n" + parts.map(p => theme.fg("dim", p)).join(" " + theme.fg("dim", "·") + " ");
        }

        if (expanded) {
          const lines = d.resultPreview.split("\n").slice(0, 30);
          for (const l of lines) line += "\n" + theme.fg("dim", `  ${l}`);
        } else {
          const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
          line += "\n" + theme.fg("dim", `⎿  ${preview}`);
        }

        if (d.outputFile) {
          line += "\n" + theme.fg("muted", `transcript: ${d.outputFile}`);
        }

        return line;
      }

      const all = [d, ...(d.others ?? [])];
      return new Text(all.map(renderOne).join("\n"), 0, 0);
    }
  );
}
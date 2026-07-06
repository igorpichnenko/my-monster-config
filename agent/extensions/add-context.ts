import type { ExtensionAPI, ExtensionCommandContext, MessageRenderOptions } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("add_context", {
    description: "Отправить контекст модели (приостанавливает текущую работу)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("❌ Укажи текст после /add_context", "error");
        return;
      }

      pi.sendMessage(
        {
          customType: "add-context",
          content: text,
          display: true,
        },
        { triggerTurn: true, deliverAs: "steer" }
      );

      ctx.ui.notify(`📝 Контекст отправлен модели`, "info");
    },
  });

  pi.registerMessageRenderer("add-context", (message, _opts: MessageRenderOptions, theme: Theme) => {
    return new Text(
      theme.fg("success", `📝 [add_context] ${String(message.content)}`),
      0,
      0
    );
  });
}

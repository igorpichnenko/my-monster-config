import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXT_DIR, "loop-police.json");

const DEFAULTS = {
  MIN_THINKING_WINDOW: 80,
  MAX_THINKING_WINDOW: 2000,
  CHECK_STRIDE: 50,
  PARA_MIN_LEN: 40,
  PARA_FINGERPRINT_LEN: 60,
  PARA_LOOP_THRESHOLD: 6,
  PARA_SIMILARITY_THRESHOLD: 0.7,
  STAGNATION_WINDOW: 5,
  STAGNATION_THRESHOLD: 0.85,
  FILE_READ_LIMIT: 10,
  FILE_READ_MAX_AGE_SEC: 600,
  REPEATED_TOOL_CALL_LIMIT: 3,
  ENABLE_TOOL_SEQUENCE_DETECTION: 0,
  TOOL_SEQUENCE_WINDOW: 6,
  CONSECUTIVE_LOOP_LIMIT: 6,
  RECOVERY_TURNS: 6,
  TOOL_HISTORY_MAX_AGE_SEC: 300,
};

type ConfigKey = keyof typeof DEFAULTS;

// ============================================================================
// Валидация конфигурации
// ============================================================================
function validateConfig(raw: Record<string, unknown>): typeof DEFAULTS {
  const result: Record<string, number> = { ...DEFAULTS };

  for (const key of Object.keys(DEFAULTS)) {
    const rawVal = raw[key];
    if (rawVal !== undefined) {
      const parsed = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
      if (typeof parsed === "number" && isFinite(parsed) && parsed >= 0) {
        result[key] = parsed;
      }
    }
  }

  // Защита от логических противоречий
  if (result.MAX_THINKING_WINDOW <= 0) {
    result.MAX_THINKING_WINDOW = DEFAULTS.MAX_THINKING_WINDOW;
  }
  if (result.MIN_THINKING_WINDOW >= result.MAX_THINKING_WINDOW) {
    result.MIN_THINKING_WINDOW = Math.min(DEFAULTS.MIN_THINKING_WINDOW, result.MAX_THINKING_WINDOW - 1);
  }
  if (result.MIN_THINKING_WINDOW <= 0) {
    result.MIN_THINKING_WINDOW = DEFAULTS.MIN_THINKING_WINDOW;
  }
  if (result.CHECK_STRIDE <= 0) {
    result.CHECK_STRIDE = DEFAULTS.CHECK_STRIDE;
  }
  if (result.STAGNATION_THRESHOLD < 0 || result.STAGNATION_THRESHOLD > 1) {
    result.STAGNATION_THRESHOLD = DEFAULTS.STAGNATION_THRESHOLD;
  }
  if (result.PARA_SIMILARITY_THRESHOLD < 0 || result.PARA_SIMILARITY_THRESHOLD > 1) {
    result.PARA_SIMILARITY_THRESHOLD = DEFAULTS.PARA_SIMILARITY_THRESHOLD;
  }
  if (result.PARA_LOOP_THRESHOLD < 2) {
    result.PARA_LOOP_THRESHOLD = DEFAULTS.PARA_LOOP_THRESHOLD;
  }
  if (result.STAGNATION_WINDOW < 2) {
    result.STAGNATION_WINDOW = DEFAULTS.STAGNATION_WINDOW;
  }
  if (result.CONSECUTIVE_LOOP_LIMIT < 1) {
    result.CONSECUTIVE_LOOP_LIMIT = DEFAULTS.CONSECUTIVE_LOOP_LIMIT;
  }
  if (result.REPEATED_TOOL_CALL_LIMIT < 1) {
    result.REPEATED_TOOL_CALL_LIMIT = DEFAULTS.REPEATED_TOOL_CALL_LIMIT;
  }
  if (result.FILE_READ_LIMIT < 1) {
    result.FILE_READ_LIMIT = DEFAULTS.FILE_READ_LIMIT;
  }
  if (result.FILE_READ_MAX_AGE_SEC <= 0) {
    result.FILE_READ_MAX_AGE_SEC = DEFAULTS.FILE_READ_MAX_AGE_SEC;
  }
  if (result.RECOVERY_TURNS < 1) {
    result.RECOVERY_TURNS = DEFAULTS.RECOVERY_TURNS;
  }
  if (result.TOOL_SEQUENCE_WINDOW < 1) {
    result.TOOL_SEQUENCE_WINDOW = DEFAULTS.TOOL_SEQUENCE_WINDOW;
  }
  if (result.TOOL_HISTORY_MAX_AGE_SEC <= 0) {
    result.TOOL_HISTORY_MAX_AGE_SEC = DEFAULTS.TOOL_HISTORY_MAX_AGE_SEC;
  }

  return result as typeof DEFAULTS;
}

const cfg: typeof DEFAULTS & { [key: string]: number } = (() => {
  if (!existsSync(CONFIG_PATH)) {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
    } catch (err) {
      console.error("[loop-police] Failed to write default config:", err);
    }
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return validateConfig(raw);
  } catch (err) {
    console.error("[loop-police] Failed to parse config, using defaults:", err);
    return { ...DEFAULTS };
  }
})();

// ============================================================================
// Состояние для каждого агента
// ============================================================================
interface AgentState {
  thinkingAborted: boolean;
  cleanThinkingPrefix: string | null;
  lastCheckedLen: number;
  loopType: "character" | "semantic";

  toolHistory: string[];
  toolLoopTriggered: boolean;
  pendingToolReset: boolean;
  lastToolCallTimestamp: number;

  lastToolCallHash: string | null;
  repeatedToolCallCount: number;

  thinkingHistory: string[];
  fileReadCounts: Map<string, number>;
  fileReadTimestamps: Map<string, number>;

  consecutiveLoopCount: number;
  recoveryMode: boolean;
  recoveryTurnsLeft: number;
}

function createAgentState(): AgentState {
  return {
    thinkingAborted: false,
    cleanThinkingPrefix: null,
    lastCheckedLen: 0,
    loopType: "character",
    toolHistory: [],
    toolLoopTriggered: false,
    pendingToolReset: false,
    lastToolCallTimestamp: 0,
    lastToolCallHash: null,
    repeatedToolCallCount: 0,
    thinkingHistory: [],
    fileReadCounts: new Map(),
    fileReadTimestamps: new Map(),
    consecutiveLoopCount: 0,
    recoveryMode: false,
    recoveryTurnsLeft: 0,
  };
}

export default function (pi: ExtensionAPI) {
  const agentStates = new Map<string, AgentState>();

  function getAgentState(sessionId: string): AgentState {
    if (!agentStates.has(sessionId)) {
      agentStates.set(sessionId, createAgentState());
    }
    return agentStates.get(sessionId)!;
  }

  function resetAgent(sessionId: string) {
    agentStates.set(sessionId, createAgentState());
  }

  function resetAll() {
    agentStates.clear();
  }

  // ==========================================================================
  // Обработчики событий — каждый обёрнут в try-catch для стабильности
  // ==========================================================================

  pi.on("agent_start", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      resetAgent(sessionId);
    } catch (err) {
      console.error("[loop-police] Error in agent_start:", err);
    }
  });

  pi.on("agent_end", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      agentStates.delete(sessionId);
    } catch (err) {
      console.error("[loop-police] Error in agent_end:", err);
    }
  });

  pi.on("turn_start", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      const state = getAgentState(sessionId);

      state.lastCheckedLen = 0;
      state.thinkingAborted = false;
      state.cleanThinkingPrefix = null;
      state.loopType = "character";
      state.toolLoopTriggered = false;

      if (state.recoveryMode) {
        state.recoveryTurnsLeft--;
        if (state.recoveryTurnsLeft <= 0) {
          state.recoveryMode = false;
          state.recoveryTurnsLeft = 0;
        }
      }
    } catch (err) {
      console.error("[loop-police] Error in turn_start:", err);
    }
  });

  pi.on("message_update", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      const state = getAgentState(sessionId);

      if (state.thinkingAborted || event.message?.role !== "assistant") return;

      const thinking = extractThinking(event.message);
      if (!thinking || thinking.length < state.lastCheckedLen + cfg.CHECK_STRIDE) return;

      state.lastCheckedLen = thinking.length;
      if (thinking.length < cfg.MIN_THINKING_WINDOW * 2) return;

      let repeat = detectRepeatingSuffix(thinking);
      if (repeat) {
        state.loopType = "character";
      } else {
        repeat = detectSemanticLoop(thinking);
        if (repeat) state.loopType = "semantic";
      }

      if (!repeat) return;

      state.thinkingAborted = true;
      state.cleanThinkingPrefix = repeat.cleanPrefix;
      state.consecutiveLoopCount++;
      state.pendingToolReset = true;

      if (state.consecutiveLoopCount >= cfg.CONSECUTIVE_LOOP_LIMIT) {
        if (typeof ctx?.abort === "function") ctx.abort();

        state.recoveryMode = true;
        state.recoveryTurnsLeft = cfg.RECOVERY_TURNS;

        // ИСПРАВЛЕНО: НЕ сбрасываем thinkingAborted. Пусть message_end
        // сделает замену thinking (обрежет повторяющийся текст) и отправит
        // правильное сообщение с учётом consecutiveLoopCount.
        // Это предотвращает ситуацию, когда агент видит в истории
        // необрезанный повторяющийся thinking и снова входит в цикл.
        return;
      }

      if (typeof ctx?.abort === "function") ctx.abort();
    } catch (err) {
      console.error("[loop-police] Error in message_update:", err);
    }
  });

  pi.on("message_end", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      const state = getAgentState(sessionId);

      if (event.message?.role !== "assistant") return;

      if (state.thinkingAborted) {
        const prefix = state.cleanThinkingPrefix ?? "";
        const wasConsecutive = state.consecutiveLoopCount >= cfg.CONSECUTIVE_LOOP_LIMIT;
        const consecutiveCount = state.consecutiveLoopCount;

        state.thinkingAborted = false;
        state.cleanThinkingPrefix = null;
        state.lastCheckedLen = 0;
        state.consecutiveLoopCount = 0; // сбрасываем после обработки

        const isSemantic = state.loopType === "semantic";

        let label: string;
        let advice: string;

        if (wasConsecutive) {
          label = "[CONSECUTIVE LOOP — truncated by loop-police]";
          advice = `⚠️ CONSECUTIVE THINKING LOOP (${consecutiveCount}x) in agent ${sessionId}: You have entered a thinking loop ${consecutiveCount} times in a row. Stop thinking and provide a direct answer or ask for clarification. Recovery mode activated for next ${cfg.RECOVERY_TURNS} turns.`;
        } else {
          label = isSemantic
            ? "[SEMANTIC LOOP — truncated by loop-police]"
            : "[THINKING LOOP — truncated by loop-police]";
          advice = isSemantic
            ? `⚠️ SEMANTIC LOOP DETECTED in agent ${sessionId}: Your thinking block was cycling through the same reasoning steps repeatedly. The repeated section has been truncated. Step back and try a completely different approach.`
            : `⚠️ THINKING LOOP DETECTED in agent ${sessionId}: Your thinking block was repeating the same phrases verbatim and has been truncated. Re-examine your approach and continue with the task.`;
        }

        const cleaned = replaceThinking(event.message, `${prefix}\n\n${label}`);
        pi.sendMessage(
          { customType: "loop-police", content: advice, display: true },
          { triggerTurn: true }
        );

        return { message: cleaned };
      }

      state.consecutiveLoopCount = 0;

      const thinking = extractThinking(event.message);
      if (thinking) {
        if (thinking.trim().length > 100) {
          state.thinkingHistory.push(thinking);
          if (state.thinkingHistory.length > cfg.STAGNATION_WINDOW) state.thinkingHistory.shift();

          if (state.thinkingHistory.length >= cfg.STAGNATION_WINDOW) {
            const stagnant = state.thinkingHistory.every(
              (t, i) => i === 0 || jaccard(state.thinkingHistory[i - 1], t) >= cfg.STAGNATION_THRESHOLD
            );

            if (stagnant) {
              state.thinkingHistory = [];
              pi.sendMessage(
                {
                  customType: "loop-police",
                  content: `⚠️ REASONING STAGNATION in agent ${sessionId}: Your thinking across the last ${cfg.STAGNATION_WINDOW} turns has been ${Math.round(cfg.STAGNATION_THRESHOLD * 100)}%+ similar — you are not making progress. Stop and try a fundamentally different approach.`,
                  display: true,
                },
                { triggerTurn: true }
              );
            }
          }
        } else {
          state.thinkingHistory = [];
        }
      }
    } catch (err) {
      console.error("[loop-police] Error in message_end:", err);
    }
  });

  pi.on("tool_call", (event: any, ctx: any) => {
    try {
      const sessionId = event?.sessionId || ctx?.sessionId || "main";
      const state = getAgentState(sessionId);
      const now = Date.now();

      // Периодическая очистка устаревших записей чтения файлов
      for (const [key, timestamp] of state.fileReadTimestamps.entries()) {
        if ((now - timestamp) / 1000 > cfg.FILE_READ_MAX_AGE_SEC) {
          state.fileReadTimestamps.delete(key);
          state.fileReadCounts.delete(key);
        }
      }

      // Очистка по таймауту tool history
      const toolHistoryAgeSec = (now - state.lastToolCallTimestamp) / 1000;
      if (state.lastToolCallTimestamp > 0 && toolHistoryAgeSec > cfg.TOOL_HISTORY_MAX_AGE_SEC) {
        state.toolHistory = [];
        state.toolLoopTriggered = false;
        state.lastToolCallHash = null;
        state.repeatedToolCallCount = 0;
      }
      state.lastToolCallTimestamp = now;

      if (state.pendingToolReset) {
        state.pendingToolReset = false;
        state.toolHistory = [];
        state.toolLoopTriggered = false;
      }

      // File read repetition
      if (isReadTool(event.toolName)) {
        const rawPath = getInputPath(event.input);
        if (rawPath) {
          const { cleanPath, start, end } = parsePathWithRange(rawPath);
          const key = `${cleanPath}:${start}:${end}`;

          const lastReadSec = (now - (state.fileReadTimestamps.get(key) || 0)) / 1000;
          if (state.fileReadTimestamps.has(key) && lastReadSec > cfg.FILE_READ_MAX_AGE_SEC) {
            state.fileReadCounts.delete(key);
          }

          const count = (state.fileReadCounts.get(key) ?? 0) + 1;
          state.fileReadCounts.set(key, count);
          state.fileReadTimestamps.set(key, now);

          const limit = state.recoveryMode ? cfg.FILE_READ_LIMIT * 2 : cfg.FILE_READ_LIMIT;

          if (count >= limit) {
            ctx.ui.notify(`⚠️ FILE READ LOOP in agent ${sessionId}: "${cleanPath}" lines ${start}-${end} read ${count}x — blocked`, "warning");
            pi.sendMessage(
              {
                customType: "loop-police",
                content: `⚠️ FILE READ LOOP in agent ${sessionId}: "${cleanPath}" (lines ${start}-${end}) has been read ${count} times. Reading the same range again will not yield new information — use what you already know and move forward.`,
                display: true,
              },
              { triggerTurn: true }
            );
            return { block: true, reason: `loop-police: file read ${count}x — ${cleanPath}:${start}:${end}` };
          }
        }
      }

      // Детектор повторяющихся вызовов
      const currentHash = hashToolCall(event.toolName, event.input);

      if (state.lastToolCallHash === currentHash) {
        state.repeatedToolCallCount++;

        if (state.repeatedToolCallCount >= cfg.REPEATED_TOOL_CALL_LIMIT) {
          ctx.ui.notify(`⚠️ REPEATED TOOL CALL in agent ${sessionId}: "${event.toolName}" called ${state.repeatedToolCallCount}x with same args — blocked`, "warning");
          pi.sendMessage(
            {
              customType: "loop-police",
              content: `⚠️ REPEATED TOOL CALL in agent ${sessionId}: You are calling "${event.toolName}" with the same arguments ${state.repeatedToolCallCount} times in a row. This is not working — try a different approach or check if the previous call actually succeeded.`,
              display: true,
            },
            { triggerTurn: true }
          );
          return { block: true, reason: `loop-police: repeated tool call ${state.repeatedToolCallCount}x` };
        }
      } else {
        state.lastToolCallHash = currentHash;
        state.repeatedToolCallCount = 1;
      }

      // Опциональная sequence detection
      if (cfg.ENABLE_TOOL_SEQUENCE_DETECTION) {
        if (state.toolLoopTriggered) {
          return { block: true, reason: "loop-police: still in tool call loop" };
        }

        const candidate = [...state.toolHistory, currentHash];
        const windowSize = detectSequenceRepeat(candidate);

        if (windowSize > 0) {
          state.toolLoopTriggered = true;
          ctx.ui.notify(`⚠️ TOOL LOOP in agent ${sessionId}: ${windowSize}-call sequence repeating — blocked`, "warning");
          pi.sendMessage(
            {
              customType: "loop-police",
              content: `⚠️ TOOL CALL LOOP in agent ${sessionId}: The same sequence of ${windowSize} tool call(s) is repeating identically. The repeated call has been blocked — your current strategy is not working, reconsider your approach entirely.`,
              display: true,
            },
            { triggerTurn: true }
          );
          return { block: true, reason: `loop-police: ${windowSize}-call sequence repeating` };
        }

        state.toolHistory.push(currentHash);

        const maxHistory = cfg.TOOL_SEQUENCE_WINDOW * 2;
        if (state.toolHistory.length > maxHistory) {
          state.toolHistory = state.toolHistory.slice(-maxHistory);
        }
      }
    } catch (err) {
      console.error("[loop-police] Error in tool_call:", err);
    }
  });

  pi.registerCommand("loop-police", {
    description: "Show status; /loop-police reset [all|<sessionId>]; /loop-police set KEY=VAL [KEY=VAL ...]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const trimmed = args?.trim() ?? "";

        if (trimmed === "reset" || trimmed === "reset all") {
          resetAll();
          ctx.ui.notify("Loop Police: all agent states reset", "info");
          return;
        }

        if (trimmed.startsWith("reset ")) {
          const sessionId = trimmed.slice(6).trim();
          resetAgent(sessionId);
          ctx.ui.notify(`Loop Police: agent ${sessionId} state reset`, "info");
          return;
        }

        if (trimmed.startsWith("set ")) {
          const results: string[] = [];
          const allowedKeys = new Set(Object.keys(DEFAULTS));
          for (const pair of trimmed.slice(4).trim().split(/\s+/)) {
            const eq = pair.indexOf("=");
            if (eq <= 0) {
              results.push(`invalid: ${pair}`);
              continue;
            }
            const key = pair.slice(0, eq);
            const val = pair.slice(eq + 1);

            if (!allowedKeys.has(key)) {
              results.push(`unknown key: ${key}`);
              continue;
            }

            const parsed = parseFloat(val);
            if (!isFinite(parsed) || parsed < 0) {
              results.push(`${key}: invalid value "${val}"`);
              continue;
            }

            const testCfg = { ...cfg, [key]: parsed };
            const validated = validateConfig(testCfg as Record<string, unknown>);
            (cfg as any)[key] = validated[key as ConfigKey];
            results.push(`${key}=${(cfg as any)[key]}`);
          }
          ctx.ui.notify(`Loop Police: ${results.join(", ")}`, "info");
          return;
        }

        const lines = [
          "Loop Police status",
          `Active agents: ${agentStates.size}`,
          "",
        ];

        for (const [sessionId, state] of agentStates.entries()) {
          lines.push(`Agent: ${sessionId}`);
          lines.push(`  thinking aborted:    ${state.thinkingAborted}`);
          lines.push(`  tool history:        ${state.toolHistory.length} calls`);
          lines.push(`  tool loop triggered: ${state.toolLoopTriggered}`);
          lines.push(`  pending tool reset:  ${state.pendingToolReset}`);
          lines.push(`  repeated tool calls: ${state.repeatedToolCallCount}/${cfg.REPEATED_TOOL_CALL_LIMIT}`);
          lines.push(`  stagnation history:  ${state.thinkingHistory.length}/${cfg.STAGNATION_WINDOW} turns`);
          lines.push(`  file reads tracked:  ${state.fileReadCounts.size} ranges`);
          lines.push(`  consecutive loops:   ${state.consecutiveLoopCount}/${cfg.CONSECUTIVE_LOOP_LIMIT}`);
          lines.push(`  recovery mode:       ${state.recoveryMode} (${state.recoveryTurnsLeft} turns left)`);
          lines.push("");
        }

        lines.push("config (set KEY=VAL to change):");
        lines.push(...Object.entries(cfg).map(([k, v]) => `  ${k}=${v}`));

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        console.error("[loop-police] Error in command handler:", err);
        ctx.ui.notify(`Loop Police error: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerMessageRenderer("loop-police", (message, _opts, theme) => {
    try {
      return new Text(theme.fg("warning", String(message.content)), 0, 0);
    } catch (err) {
      console.error("[loop-police] Error in message renderer:", err);
      return new Text(String(message.content), 0, 0);
    }
  });
}

// ============================================================================
// Helper functions
// ============================================================================

function jaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 1 : inter / union;
}

function isReadTool(name: string): boolean {
  return /\b(read|view|cat)\b/i.test(name);
}

function getInputPath(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (typeof input !== "object" || !input) return null;
  const inp = input as any;
  return inp.path ?? inp.file_path ?? inp.filename ?? inp.file ?? inp.directory ?? inp.dir ?? null;
}

function parsePathWithRange(path: string): { cleanPath: string; start: number; end: number } {
  const matchRange = path.match(/^(.+?):(\d+)-(\d+)$/);
  if (matchRange) {
    return {
      cleanPath: matchRange[1],
      start: parseInt(matchRange[2], 10),
      end: parseInt(matchRange[3], 10),
    };
  }

  const matchStart = path.match(/^(.+?):(\d+)-$/);
  if (matchStart) {
    return {
      cleanPath: matchStart[1],
      start: parseInt(matchStart[2], 10),
      end: 0,
    };
  }

  const matchEnd = path.match(/^(.+?)-(\d+)$/);
  if (matchEnd && !matchEnd[1].includes(":")) {
    return {
      cleanPath: matchEnd[1],
      start: 0,
      end: parseInt(matchEnd[2], 10),
    };
  }

  const matchSingle = path.match(/^(.+?):(\d+)$/);
  if (matchSingle) {
    const lineNum = parseInt(matchSingle[2], 10);
    return {
      cleanPath: matchSingle[1],
      start: lineNum,
      end: lineNum,
    };
  }

  return { cleanPath: path, start: 0, end: 0 };
}

function extractThinking(message: any): string | null {
  if (!Array.isArray(message?.content)) return null;
  for (const block of message.content) {
    if (block?.type === "thinking" && typeof block.thinking === "string")
      return block.thinking;
  }
  return null;
}

function replaceThinking(message: any, newText: string): any {
  if (!Array.isArray(message?.content)) return message;
  let done = false;
  const content = message.content.map((block: any) => {
    if (done || block?.type !== "thinking") return block;
    done = true;
    return { ...block, thinking: newText };
  });
  return { ...message, content };
}

function detectSemanticLoop(text: string): { cleanPrefix: string } | null {
  const paragraphs: { start: number; text: string }[] = [];
  let searchFrom = 0;

  for (const para of text.split(/\n\n+/)) {
    const paraStart = text.indexOf(para, searchFrom);
    if (paraStart === -1) continue;
    searchFrom = paraStart + para.length;

    const trimmed = para.trim();
    if (trimmed.length >= cfg.PARA_MIN_LEN) {
      paragraphs.push({ start: paraStart, text: trimmed });
    }
  }

  if (paragraphs.length < cfg.PARA_LOOP_THRESHOLD) return null;

  const recent = paragraphs.slice(-cfg.PARA_LOOP_THRESHOLD);
  let similarCount = 0;
  let firstSimilarIdx = -1;

  for (let i = 1; i < recent.length; i++) {
    const sim = jaccard(recent[i - 1].text, recent[i].text);
    if (sim >= cfg.PARA_SIMILARITY_THRESHOLD) {
      similarCount++;
      if (firstSimilarIdx === -1) firstSimilarIdx = i - 1;
    }
  }

  if (similarCount >= cfg.PARA_LOOP_THRESHOLD - 1 && firstSimilarIdx >= 0) {
    const cutStart = recent[firstSimilarIdx].start;
    return { cleanPrefix: text.slice(0, cutStart) };
  }

  const counts = new Map<string, number>();
  const firstOccurrence = new Map<string, number>();
  for (const para of paragraphs) {
    const key = para.text.slice(0, cfg.PARA_FINGERPRINT_LEN);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (!firstOccurrence.has(key)) {
      firstOccurrence.set(key, para.start);
    }

    if (count >= cfg.PARA_LOOP_THRESHOLD) {
      return { cleanPrefix: text.slice(0, firstOccurrence.get(key)!) };
    }
  }

  return null;
}

function detectRepeatingSuffix(text: string): { cleanPrefix: string } | null {
  const n = text.length;
  const limit = Math.min(cfg.MAX_THINKING_WINDOW, Math.floor(n / 2));

  const minW = Math.max(1, cfg.MIN_THINKING_WINDOW);
  if (minW > limit) return null;

  for (let w = minW; w <= limit; w++) {
    const tail = text.slice(n - w);
    const prev = text.slice(n - 2 * w, n - w);

    if (prev.length === w && tail === prev) {
      return { cleanPrefix: text.slice(0, n - w) };
    }
  }

  return null;
}

function detectSequenceRepeat(history: string[]): number {
  const n = history.length;
  const maxWindow = Math.min(cfg.TOOL_SEQUENCE_WINDOW, Math.floor(n / 2));

  if (maxWindow < 1) return 0;

  for (let w = 1; w <= maxWindow; w++) {
    const tail = history.slice(n - w);
    const prev = history.slice(n - w * 2, n - w);

    if (prev.length === w && tail.every((v, i) => v === prev[i])) {
      return w;
    }
  }

  return 0;
}

function hashToolCall(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(input)}`;
}

function stableStringify(val: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);

  if (seen.has(val as object)) return '"[Circular]"';
  seen.add(val as object);

  if (Array.isArray(val)) {
    return `[${val.map((v) => stableStringify(v, seen)).join(",")}]`;
  }

  const keys = Object.keys(val as object).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((val as any)[k], seen)}`)
    .join(",")}}`;
}
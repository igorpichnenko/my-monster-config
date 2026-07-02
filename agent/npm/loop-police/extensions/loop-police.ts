import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  PARA_LOOP_THRESHOLD: 3,
  PARA_SIMILARITY_THRESHOLD: 0.7,
  STAGNATION_WINDOW: 5,
  STAGNATION_THRESHOLD: 0.85,
  FILE_READ_LIMIT: 5,
  FILE_READ_MAX_AGE_SEC: 600,
  REPEATED_TOOL_CALL_LIMIT: 3,
  ENABLE_TOOL_SEQUENCE_DETECTION: 0,
  TOOL_SEQUENCE_WINDOW: 6,
  CONSECUTIVE_LOOP_LIMIT: 3,
  RECOVERY_TURNS: 3,
  TOOL_HISTORY_MAX_AGE_SEC: 300,
};

const cfg: typeof DEFAULTS & { [key: string]: number } = (() => {
  if (!existsSync(CONFIG_PATH)) {
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf-8");
    } catch {}
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
})();

// ============================================================================
// НОВОЕ: Состояние для каждого агента
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
  // НОВОЕ: Состояние для каждого агента (по sessionId или agentId)
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

  pi.on("agent_start", (event: any, ctx: any) => {
    // НОВОЕ: Определяем sessionId агента
    const sessionId = event?.sessionId || ctx?.sessionId || "main";
    resetAgent(sessionId);
  });

  pi.on("turn_start", (event: any, ctx: any) => {
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
      }
    }
  });

  pi.on("message_update", (event: any, ctx: any) => {
    const sessionId = event?.sessionId || ctx?.sessionId || "main";
    const state = getAgentState(sessionId);
    
    if (state.thinkingAborted || event.message.role !== "assistant") return;
    
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
      
      pi.sendMessage(
        {
          customType: "loop-police",
          content: `⚠️ CONSECUTIVE THINKING LOOP (${state.consecutiveLoopCount}x) in agent ${sessionId}: You have entered a thinking loop ${state.consecutiveLoopCount} times in a row. Stop thinking and provide a direct answer or ask for clarification. Recovery mode activated for next ${cfg.RECOVERY_TURNS} turns.`,
          display: true,
        },
        { triggerTurn: true }
      );
      return;
    }

    if (typeof ctx?.abort === "function") ctx.abort();
  });

  pi.on("message_end", (event: any, ctx: any) => {
    const sessionId = event?.sessionId || ctx?.sessionId || "main";
    const state = getAgentState(sessionId);
    
    if (event.message.role !== "assistant") return;

    if (state.thinkingAborted) {
      const prefix = state.cleanThinkingPrefix ?? "";
      state.thinkingAborted = false;
      state.cleanThinkingPrefix = null;
      state.lastCheckedLen = 0;

      const isSemantic = state.loopType === "semantic";
      const label = isSemantic
        ? "[SEMANTIC LOOP — truncated by loop-police]"
        : "[THINKING LOOP — truncated by loop-police]";
      const advice = isSemantic
        ? `⚠️ SEMANTIC LOOP DETECTED in agent ${sessionId}: Your thinking block was cycling through the same reasoning steps repeatedly. The repeated section has been truncated. Step back and try a completely different approach.`
        : `⚠️ THINKING LOOP DETECTED in agent ${sessionId}: Your thinking block was repeating the same phrases verbatim and has been truncated. Re-examine your approach and continue with the task.`;

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
  });

  pi.on("tool_call", (event: any, ctx: any) => {
    const sessionId = event?.sessionId || ctx?.sessionId || "main";
    const state = getAgentState(sessionId);
    const now = Date.now();
    
    // Очистка по таймауту
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

    // ДЕТЕКТОР ПОВТОРЯЮЩИХСЯ ВЫЗОВОВ
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
  });

  pi.registerCommand("loop-police", {
    description: "Show status; /loop-police reset [all|<sessionId>]; /loop-police set KEY=VAL [KEY=VAL ...]",
    handler: (args, ctx) => {
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
        for (const pair of trimmed.slice(4).trim().split(/\s+/)) {
          const eq = pair.indexOf("=");
          const key = pair.slice(0, eq);
          const val = pair.slice(eq + 1);
          if (eq > 0 && key in cfg && val !== "") {
            (cfg as any)[key] = parseFloat(val);
            results.push(`${key}=${(cfg as any)[key]}`);
          } else {
            results.push(`unknown: ${key}`);
          }
        }
        ctx.ui.notify(`Loop Police: ${results.join(", ")}`, "info");
        return;
      }

      // Показываем статус для всех агентов
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
    },
  });

  pi.registerMessageRenderer("loop-police", (message, _opts, theme) =>
    new Text(theme.fg("warning", String(message.content)), 0, 0)
  );
}

// ============================================================================
// Helper functions (без изменений)
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
  return /\bread|view|cat\b/i.test(name);
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
    if (block.type === "thinking" && typeof block.thinking === "string")
      return block.thinking;
  }
  return null;
}

function replaceThinking(message: any, newText: string): any {
  if (!Array.isArray(message?.content)) return message;
  let done = false;
  const content = message.content.map((block: any) => {
    if (done || block.type !== "thinking") return block;
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
  
  for (let i = 1; i < recent.length; i++) {
    const sim = jaccard(recent[i - 1].text, recent[i].text);
    if (sim >= cfg.PARA_SIMILARITY_THRESHOLD) {
      similarCount++;
    }
  }
  
  if (similarCount >= cfg.PARA_LOOP_THRESHOLD - 1) {
    const firstSimilarStart = recent[0].start;
    return { cleanPrefix: text.slice(0, firstSimilarStart) };
  }
  
  const counts = new Map<string, number>();
  for (const para of paragraphs) {
    const key = para.text.slice(0, cfg.PARA_FINGERPRINT_LEN);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    
    if (count >= cfg.PARA_LOOP_THRESHOLD) {
      return { cleanPrefix: text.slice(0, para.start) };
    }
  }
  
  return null;
}

function detectRepeatingSuffix(text: string): { cleanPrefix: string } | null {
  const n = text.length;
  const limit = Math.min(cfg.MAX_THINKING_WINDOW, Math.floor(n / 2));
  
  for (let w = cfg.MIN_THINKING_WINDOW; w <= limit; w++) {
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

function stableStringify(val: unknown): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  
  const keys = Object.keys(val as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((val as any)[k])}`).join(",")}}`;
}
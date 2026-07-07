/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * All default agents are disabled by default. User agents from
 * .pi/agents/*.md are loaded via custom-agents.ts.
 */

import type { AgentConfig } from "./types.js";

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map();

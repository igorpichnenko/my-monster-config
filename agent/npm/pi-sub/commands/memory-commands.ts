/**
 * memory-commands.ts — Команды для работы с памятью.
 */

import type { PiSubContext } from "../types/pi-sub-context.js";

export function registerMemoryCommands(ctx: PiSubContext): void {
  const { pi, memoryDb, sessionMemory } = ctx;

  // /memory-stats
  pi.registerCommand("memory-stats", {
    description: "Show memory database statistics",
    handler: async (_args, cmdCtx) => {
      if (!memoryDb) {
        cmdCtx.ui.notify("❌ Memory database not initialized", "error");
        return;
      }

      try {
        const stats = memoryDb.getStats();
        const recentFacts = memoryDb.getRecentFacts(5);
        
        const lines = [
          `📊 Memory Database Statistics`,
          ``,
          `Tool outputs: ${stats.toolOutputs}`,
          `Subagent results: ${stats.subagentResults}`,
          `Session facts: ${stats.sessionFacts}`,
          `Compressed results: ${stats.compressedResults}`,
          `Database size: ${stats.dbSizeMb.toFixed(2)} MB`,
        ];
        
        if (recentFacts.length > 0) {
          lines.push(``);
          lines.push(`📝 Recent facts:`);
          for (const fact of recentFacts) {
            const date = new Date(fact.timestamp).toLocaleString();
            const contentPreview = fact.content.length > 60 
              ? fact.content.slice(0, 60) + '...' 
              : fact.content;
            const icon = {
              decision: "🎯",
              lesson: "💡",
              preference: "⭐",
              architecture: "🏗️",
              api: "🔌",
            }[fact.fact_type] || "📝";
            lines.push(`  ${icon} [${fact.fact_type}] ${contentPreview}`);
            lines.push(`    ${date}`);
          }
        } else {
          lines.push(``);
          lines.push(`📝 No facts saved yet. Use /memory-add or /memory-test.`);
        }
        
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // /memory-test
  pi.registerCommand("memory-test", {
    description: "Test memory database operations",
    handler: async (_args, cmdCtx) => {
      if (!memoryDb) {
        cmdCtx.ui.notify("❌ Memory database not initialized", "error");
        return;
      }

      const results: string[] = [];
      
      try {
        const toolId = memoryDb.saveToolOutput({
          toolName: "bash",
          args: JSON.stringify({ command: "echo test" }),
          output: "test output from bash command\nline 2\nline 3",
          summary: "Test summary: bash command executed",
        });
        results.push(`✅ Tool output saved (ID: ${toolId})`);
        
        const tool = memoryDb.getToolOutput(toolId);
        results.push(`✅ Tool output retrieved: ${tool?.tool_name}`);
        
        const toolSearch = memoryDb.searchToolOutputs("bash");
        results.push(`✅ Tool search: ${toolSearch.length} results`);
        
        const testAgentId = `test-${Date.now()}`;
        memoryDb.saveSubagentResult({
          id: testAgentId,
          agentType: "general-purpose",
          description: "Test task from /memory-test",
          result: "Test result from subagent\nWith multiple lines\nAnd some details",
          status: "completed",
          toolUses: 5,
          durationMs: 12345,
        });
        results.push(`✅ Subagent result saved (ID: ${testAgentId})`);
        
        const agentResult = memoryDb.getSubagentResult(testAgentId);
        results.push(`✅ Subagent result retrieved: ${agentResult?.description}`);
        
        const factId = memoryDb.saveFact({
          sessionId: `session-${Date.now()}`,
          factType: "decision",
          content: "Test decision: using TypeScript strict mode for all new files",
        });
        results.push(`✅ Session fact saved (ID: ${factId})`);
        
        const factSearch = memoryDb.searchFacts("TypeScript");
        results.push(`✅ Fact search: ${factSearch.length} results`);
        
        memoryDb.saveCompressedResult("test-hash-123", "compressed text from test");
        const cached = memoryDb.getCompressedResult("test-hash-123");
        results.push(`✅ Compressed cache: ${cached === "compressed text from test" ? "OK" : "FAIL"}`);
        
        const stats = memoryDb.getStats();
        results.push(`✅ Stats: ${stats.toolOutputs} tools, ${stats.subagentResults} agents, ${stats.sessionFacts} facts, ${stats.dbSizeMb.toFixed(2)} MB`);
        
        cmdCtx.ui.notify(`🧪 Memory DB Test Results:\n\n${results.join("\n")}\n\n💡 Use /memory-stats to see full statistics.`, "info");
      } catch (err) {
        results.push(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
        cmdCtx.ui.notify(`❌ Test failed:\n\n${results.join("\n")}`, "error");
      }
    },
  });

  // /memory-purge
  pi.registerCommand("memory-purge", {
    description: "Purge old data from memory database",
    handler: async (argStr, cmdCtx) => {
      if (!memoryDb) {
        cmdCtx.ui.notify("❌ Memory database not initialized", "error");
        return;
      }

      const args = argStr.trim();
      let toolsDays = 7;
      let factsDays = 30;
      
      if (args) {
        const toolsMatch = args.match(/tools=(\d+)/);
        const factsMatch = args.match(/facts=(\d+)/);
        if (toolsMatch) toolsDays = parseInt(toolsMatch[1], 10);
        if (factsMatch) factsDays = parseInt(factsMatch[1], 10);
      }

      try {
        const statsBefore = memoryDb.getStats();
        const deletedTools = memoryDb.purgeOldToolOutputs(toolsDays);
        const deletedFacts = memoryDb.purgeOldFacts(factsDays);
        const statsAfter = memoryDb.getStats();
        
        const lines = [
          `🧹 Memory Database Cleanup`,
          ``,
          `Tool outputs (> ${toolsDays} days): deleted ${deletedTools}`,
          `Session facts (> ${factsDays} days): deleted ${deletedFacts}`,
          ``,
          `Before: ${statsBefore.toolOutputs} tools, ${statsBefore.sessionFacts} facts, ${statsBefore.dbSizeMb.toFixed(2)} MB`,
          `After: ${statsAfter.toolOutputs} tools, ${statsAfter.sessionFacts} facts, ${statsAfter.dbSizeMb.toFixed(2)} MB`,
        ];
        
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // /memory-search <query>
  pi.registerCommand("memory-search", {
    description: "Search memory database: /memory-search <query>",
    handler: async (argStr, cmdCtx) => {
      if (!memoryDb) {
        cmdCtx.ui.notify("❌ Memory database not initialized", "error");
        return;
      }

      const query = argStr.trim();
      if (!query) {
        cmdCtx.ui.notify("Usage: /memory-search <query>", "warning");
        return;
      }

      try {
        const lines: string[] = [];
        
        const toolResults = memoryDb.searchToolOutputs(query, 5);
        if (toolResults.length > 0) {
          lines.push(`🔧 Tool outputs (${toolResults.length}):`);
          for (const t of toolResults) {
            const date = new Date(t.timestamp).toLocaleString();
            lines.push(`  [ID:${t.id}] ${t.tool_name} (${date})`);
            lines.push(`    ${t.summary.slice(0, 80)}`);
          }
          lines.push(``);
        }
        
        const agentResults = memoryDb.searchSubagentResults(query, 5);
        if (agentResults.length > 0) {
          lines.push(`🤖 Subagent results (${agentResults.length}):`);
          for (const a of agentResults) {
            const date = new Date(a.timestamp).toLocaleString();
            lines.push(`  [${a.id}] ${a.description} (${date})`);
            lines.push(`    ${a.result.slice(0, 80).replace(/\n/g, ' ')}`);
          }
          lines.push(``);
        }
        
        const factResults = memoryDb.searchFacts(query, 5);
        if (factResults.length > 0) {
          lines.push(`📝 Session facts (${factResults.length}):`);
          for (const f of factResults) {
            const date = new Date(f.timestamp).toLocaleString();
            lines.push(`  [${f.fact_type}] ${f.content.slice(0, 80)} (${date})`);
          }
          lines.push(``);
        }
        
        if (lines.length === 0) {
          lines.push(`No results found for: "${query}"`);
        } else {
          lines.unshift(`🔍 Search results for: "${query}"`);
        }
        
        cmdCtx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        cmdCtx.ui.notify(`❌ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  // /memory-add <type> <content> — ФАЗА 4A
  pi.registerCommand("memory-add", {
    description: "Add fact to memory: /memory-add <type> <content>\nTypes: decision, lesson, preference, architecture, api",
    handler: async (argStr, cmdCtx) => {
      if (!memoryDb || !sessionMemory) {
        cmdCtx.ui.notify("❌ Memory database not initialized", "error");
        return;
      }

      const argStrTrimmed = argStr.trim();
      if (!argStrTrimmed) {
        cmdCtx.ui.notify(
          "Usage: /memory-add <type> <content>\n" +
          "Types: decision, lesson, preference, architecture, api\n" +
          "Example: /memory-add decision Используем PostgreSQL",
          "warning"
        );
        return;
      }

      const spaceIndex = argStrTrimmed.indexOf(" ");
      if (spaceIndex === -1) {
        cmdCtx.ui.notify("Usage: /memory-add <type> <content>", "warning");
        return;
      }

      const factType = argStrTrimmed.slice(0, spaceIndex).toLowerCase();
      const content = argStrTrimmed.slice(spaceIndex + 1).trim();

      if (!content) {
        cmdCtx.ui.notify("Content cannot be empty", "warning");
        return;
      }

      try {
        const id = sessionMemory.addManualFact(factType, content);
        cmdCtx.ui.notify(
          `✅ Fact saved (ID: ${id})\n` +
          `Type: ${factType}\n` +
          `Content: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`,
          "info"
        );
      } catch (err) {
        cmdCtx.ui.notify(`❌ Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });
}
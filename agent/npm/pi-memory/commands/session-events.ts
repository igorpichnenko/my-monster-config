/**
 * session-events.ts — События сессии для памяти.
 * Вынесено из pi-sub/session-handler.ts при разделении ответственности.
 */

import { MemoryDatabase } from "../database.js";
import { getSessionMemory, resetSessionMemory, type SessionMemory } from "../session-memory.js";
import { consolidateMemory } from "../consolidation.js";

const LAST_PURGE_KEY = Symbol.for("pi-memory:lastPurgeTimestamp");
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Регистрирует события сессии для памяти:
 * - session_start: обновление SessionId, auto-purge, auto-consolidation
 * - session_shutdown: закрытие БД, сброс SessionMemory
 */
export function registerSessionEvents(
  pi: any,
  memoryDb: MemoryDatabase,
  sessionMemory: SessionMemory | null,
): void {
  pi.on("session_start", async (event: any, ctx: any) => {
    // Обновляем SessionId при смене сессии
    if (sessionMemory) {
      const newSessionId = event?.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionMemory.setSessionId(newSessionId);
      const projectRoot = MemoryDatabase.getCurrentProjectRoot();
      if (projectRoot) sessionMemory.setProjectPath(projectRoot);
      console.log(`[pi-memory] 🧠 Session ID updated: ${newSessionId}, Project: ${projectRoot}`);
    }

    // Auto-purge — раз в неделю, по порогам
    const lastPurge = (globalThis as any)[LAST_PURGE_KEY] || 0;
    const now = Date.now();
    if (now - lastPurge > ONE_WEEK_MS) {
      const stats = memoryDb.getStats();
      if (stats.dbSizeMb > 50 || stats.toolOutputs > 5000) {
        console.log(`[pi-memory] 🧹 Running automatic purge (DB: ${stats.dbSizeMb.toFixed(1)} MB)...`);
        try {
          const d1 = memoryDb.purgeOldToolOutputs(7);
          const d2 = memoryDb.purgeOldCompactionSummaries(30);
          const d3 = memoryDb.purgeOldKeywords(30);
          const d4 = memoryDb.purgeOldCompressedResults(30);
          const sa = memoryDb.getStats();
          console.log(`[pi-memory] 🧹 Purged: ${d1} tools, ${d2} summaries, ${d3} keywords, ${d4} compressed. DB: ${stats.dbSizeMb.toFixed(1)} MB → ${sa.dbSizeMb.toFixed(1)} MB`);
          (globalThis as any)[LAST_PURGE_KEY] = now;
        } catch (err) { console.error(`[pi-memory] ❌ Purge failed:`, err); }
      }
    }

    // Auto-consolidation
    const stats = memoryDb.getStats();
    if (stats.sessionFacts > 1000) {
      console.log(`[pi-memory] 🔄 Auto-consolidation triggered (${stats.sessionFacts} facts)`);
      try {
        const projectRoot = MemoryDatabase.getCurrentProjectRoot() || undefined;
        consolidateMemory(memoryDb, { threshold: 0.7, projectPath: projectRoot });
      } catch (err) { console.error(`[pi-memory] ❌ Auto-consolidation failed:`, err); }
    }
  });

  pi.on("session_shutdown", async () => {
    if (memoryDb) {
      try { memoryDb.close(); } catch (err) { console.error(`[pi-memory] ❌ Failed to close DB:`, err); }
      finally { MemoryDatabase.resetInstance(); }
    }
    resetSessionMemory();
  });
}

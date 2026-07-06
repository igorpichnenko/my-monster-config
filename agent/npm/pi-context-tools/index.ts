/**
 * pi-context-tools — Context-aware tools extension for pi-coding-agent.
 * 
 * Предоставляет контекстно-осведомлённые инструменты:
 * - bash, read, grep, find, ls (с сохранением в БД)
 * - ctx_search (полнотекстовый поиск)
 * 
 * Зависит от: pi-memory (для MemoryDatabase)
 * 
 * Если pi-memory не загружен — ничего не делает (не падает).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./register-tools.js";

// ============================================================
// Точка входа — расширяет API при загрузке расширения
// ============================================================

export default function(pi: ExtensionAPI) {
  // Пытаемся получить БД из pi-memory
  let memoryDb: any = null;
  
  try {
    // Dynamic import — если pi-memory не загружен, catch не бросит
    // (потому что мы в node_modules, но модуль может отсутствовать в packages)
    const pm = require('pi-memory');
    if (pm && pm.MemoryDatabase) {
      memoryDb = pm.MemoryDatabase.getInstance();
    }
  } catch {
    // pi-memory не загружен — инструменты не регистрируем
    console.log('[pi-context-tools] ⚠️ pi-memory not available — tools not registered');
    return;
  }
  
  if (!memoryDb) {
    console.log('[pi-context-tools] ⚠️ MemoryDatabase not initialized — tools not registered');
    return;
  }
  
  // Регистрируем инструменты
  registerTools(pi, memoryDb);
  console.log('[pi-context-tools] ✅ Context tools registered (bash, read, grep, find, ls, ctx_search)');
}

/**
 * Возвращает список названий зарегистрированных контекстных инструментов.
 */
export function getContextToolNames(): string[] {
  return ["bash", "read", "grep", "find", "ls", "ctx_search"];
}

/**
 * igorpi-context-tools — Context-aware tools extension for pi-coding-agent.
 * 
 * Предоставляет контекстно-осведомлённые инструменты:
 * - bash, read, grep, find, ls (с сохранением в БД)
 * - ctx_search (полнотекстовый поиск)
 * 
 * Зависит от: igorpi-memory (для MemoryDatabase)
 * 
 * Если igorpi-memory не загружен — ничего не делает (не падает).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTools } from "./register-tools.js";

// ============================================================
// Точка входа — расширяет API при загрузке расширения
// ============================================================

export default function(pi: ExtensionAPI) {
  // Пытаемся получить БД из igorpi-memory
  let memoryDb: any = null;
  
  try {
    // Dynamic import — если igorpi-memory не загружен, catch не бросит
    // (потому что мы в node_modules, но модуль может отсутствовать в packages)
    const pm = require('igorpi-memory');
    if (pm && pm.MemoryDatabase) {
      memoryDb = pm.MemoryDatabase.getInstance();
    }
  } catch {
    // igorpi-memory не загружен — инструменты не регистрируем
    console.log('[igorpi-context-tools] ⚠️ igorpi-memory not available — tools not registered');
    return;
  }
  
  if (!memoryDb) {
    console.log('[igorpi-context-tools] ⚠️ MemoryDatabase not initialized — tools not registered');
    return;
  }
  
  // Регистрируем инструменты
  registerTools(pi, memoryDb);
  console.log('[igorpi-context-tools] ✅ Context tools registered (bash, read, grep, find, ls, ctx_search)');
}

/**
 * Возвращает список названий зарегистрированных контекстных инструментов.
 */
export function getContextToolNames(): string[] {
  return ["bash", "read", "grep", "find", "ls", "ctx_search"];
}

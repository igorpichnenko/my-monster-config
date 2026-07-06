# План: разделение pi-sub, pi-memory, pi-context-tools на независимые расширения

---

## ✅ Что уже сделано (текущее состояние)

### 1. `agent/settings.json` — все три расширения подключены

```json
{
  "packages": [
    "npm:pi-minimal-web",
    "npm:loop-police",
    "npm:pi-memory",
    "npm:pi-context-tools",
    "npm:pi-sub"
  ]
}
```

**Порядок важен:**
1. `pi-memory` — инициализирует singleton БД
2. `pi-context-tools` — получает БД и регистрирует инструменты
3. `pi-sub` — использует БД для субагентов

### 2. `pi-context-tools/index.ts` — сам регистрирует инструменты

**Было:** `pi-sub` вызывал `registerContextTools(pi, memoryDb)`
**Стало:** `pi-context-tools` сам при загрузке проверяет наличие `pi-memory` и регистрирует инструменты

```typescript
export default function(pi: ExtensionAPI) {
  // Пытаемся получить БД из pi-memory
  const pm = require('pi-memory');
  const memoryDb = pm?.MemoryDatabase?.getInstance();
  
  if (!memoryDb) {
    console.log('[pi-context-tools] ⚠️ pi-memory not available — tools not registered');
    return;
  }
  
  registerTools(pi, memoryDb);
}
```

### 3. `pi-sub/index.ts` — убрана регистрация инструментов

- Убран `import { registerContextTools } from "pi-context-tools"`
- Убран вызов `registerContextTools(pi, memoryDb)`
- `pi-sub` теперь только **использует** БД (для сохранения результатов субагентов и поиска фактов)

### 4. `pi-memory/index.ts` — singleton инициализация

```typescript
export default function(pi: any) {
  const db = ensureInitialized();
  const stats = db.getStats();
  console.log(`[pi-memory] 📦 Database initialized. Stats: ${stats.toolOutputs} tools...`);
}

export { MemoryDatabase, getSessionMemory, resetSessionMemory, consolidateMemory, escapeFts5Query, priorityEmoji };
```

### 5. `pi-memory/database.ts` — добавлен `isInitialized()`

```typescript
static isInitialized(): boolean {
  return MemoryDatabase.instance !== null;
}
```

---

## 🔴 Текущее состояние: НЕГОТОВО (статические импорты ломают независимость)

### Что сломается при удалении `pi-memory` из packages:

| Расширение | Статический импорт | Результат |
|------------|-------------------|-----------|
| **pi-sub** | 5 файлов | ❌ Не загрузится |
| **pi-context-tools** | 4 файла | ❌ Не загрузится |
| **pi-memory** | 0 файлов | ✅ Загрузится |

### Что сломается при удалении `pi-context-tools` из packages:

| Расширение | Статический импорт | Результат |
|------------|-------------------|-----------|
| **pi-sub** | 0 из pi-context-tools | ✅ Загрузится |
| **pi-context-tools** | — | — |

### Что сломается при удалении `pi-sub` из packages:

| Расширение | Статический импорт | Результат |
|------------|-------------------|-----------|
| **pi-memory** | 0 из pi-sub | ✅ Загрузится |
| **pi-context-tools** | 0 из pi-sub | ✅ Загрузится |

### ✅ Что работает: замена на совместимую версию

Если заменить `pi-memory` на совместимую версию (тот же API):
- ✅ symlink обновится
- ✅ динамические импорты подхватят новую версию
- ✅ всё работает

---

## 🎯 Цель: независимые расширения

Каждое расширение можно **удалить** или **заменить на совместимое** без поломки системы:

```
pi-sub (субагенты)          ← может работать без памяти (без сохранения)
pi-memory (база данных)     ← независимый модуль
pi-context-tools (инструменты) ← может работать без pi-memory (стандартные инструменты)
```

---

## 🔴 Проблема 1: статические импорты ломают независимость

### pi-sub — 5 файлов с статическими импортами из pi-memory

| # | Файл | Строка | Импорт | Что будет если удалить pi-memory |
|---|------|--------|--------|----------------------------------|
| 1 | `index.ts` | 15 | `import { MemoryDatabase, getSessionMemory, resetSessionMemory, type SessionMemory }` | ❌ **Модуль не загрузится** |
| 2 | `agent-runner.ts` | 29 | `import { MemoryDatabase, getSessionMemory, type SessionMemory }` | ❌ **Модуль не загрузится** |
| 3 | `session-handler.ts` | 6 | `import { MemoryDatabase, getSessionMemory, resetSessionMemory, consolidateMemory, type SessionMemory }` | ❌ **Модуль не загрузится** |
| 4 | `commands/memory-commands.ts` | 18 | `import { consolidateMemory, escapeFts5Query, priorityEmoji }` | ❌ **Модуль не загрузится** |
| 5 | `types/pi-sub-context.ts` | 7 | `import type { MemoryDatabase, SessionMemory }` | ⚠️ type-only, jiti может пропустить |

### pi-context-tools — 5 файлов с статическими импортами из pi-memory

| # | Файл | Строка | Импорт | Что будет если удалить pi-memory |
|---|------|--------|--------|----------------------------------|
| 1 | `register-tools.ts` | 24 | `import type { MemoryDatabase }` | ⚠️ type-only |
| 2 | `tools/ctx-stats.ts` | 7 | `import { MemoryDatabase }` | ❌ **Модуль не загрузится** |
| 3 | `tools/ctx-bash.ts` | 13 | `import { MemoryDatabase, priorityEmoji }` | ❌ **Модуль не загрузится** |
| 4 | `tools/ctx-search.ts` | 24 | `import { MemoryDatabase, type ToolOutput, ... }` | ❌ **Модуль не загрузится** |
| 5 | `tools/ctx-read.ts` | 10 | `import { MemoryDatabase, priorityEmoji }` | ❌ **Модуль не загрузится** |

### pi-memory — чистый, без зависимостей ✅

---

## ✅ Решение: динамические импорты + try/catch

### Принцип

Каждое расширение **пытается** загрузить зависимости динамически.
Если не получается — работает в **fallback-режиме**.

```typescript
// Вместо:
import { MemoryDatabase } from "pi-memory";  // ❌ статический

// Делаем:
let memoryDb: any = null;
try {
  const pm = await import('pi-memory');
  memoryDb = pm.MemoryDatabase?.getInstance?.();
} catch {
  // fallback — нет памяти
}
```

### Fallback-режимы (после реализации)

| Что удалено | Поведение pi-sub | Поведение pi-context-tools |
|-------------|------------------|---------------------------|
| **pi-memory** | Субагенты работают, результаты НЕ сохраняются | Инструменты НЕ регистрируются |
| **pi-context-tools** | Стандартные инструменты | — |
| **Оба** | Субагенты работают, стандартные инструменты | — |
| **pi-sub** | Память + контекстные инструменты работают | — |

```
┌─────────────────────────────────────────────┐
│              pi-coding-agent                │
│                                             │
│  pi-sub ──requires──→ pi-memory (optional)  │
│         ──requires──→ pi-context-tools      │
│                              (optional)       │
│                                             │
│  Если модуль не загружен:                   │
│  → fallback (no-op)                         │
│  → стандартные инструменты                  │
└─────────────────────────────────────────────┘
```

### Fallback-режимы

| Что удалено | Поведение pi-sub |
|-------------|------------------|
| **pi-memory** | Субагенты работают, результаты НЕ сохраняются, факты НЕ ищутся |
| **pi-context-tools** | Стандартные инструменты (не перезаписываются контекстными) |
| **Оба** | Субагенты работают, стандартные инструменты, без памяти |
| **pi-sub** | Память + контекстные инструменты работают для основного агента |

---

## 3. План по шагам — АКТУАЛЬНЫЙ

### ✅ Что уже готово:

1. **`pi-memory`** — ✅ Чистый, без зависимостей. `getInstance()` уже safe (singleton)
2. **`pi-context-tools/index.ts`** — ✅ Использует `require('pi-memory')` в try/catch
3. **`pi-sub/index.ts`** — ✅ Убран `registerContextTools`
4. **`pi-memory/database.ts`** — ✅ Добавлен `isInitialized()`

### 🔴 Что осталось сделать:

### Этап A: Заменить статические импорты в pi-sub (4 runtime файла)

#### pi-sub/index.ts

**Сейчас:**
```typescript
import { MemoryDatabase, getSessionMemory, resetSessionMemory, type SessionMemory } from "pi-memory";
```

**Стало:**
```typescript
export default async function(pi: any) {
  let memoryDb: any = null;
  let sessionMemory: any = null;
  let hasRealDb = false;

  try {
    const pm = await import('pi-memory') as any;
    memoryDb = pm.MemoryDatabase?.getInstance?.();
    hasRealDb = !!memoryDb;
    
    if (hasRealDb) {
      sessionMemory = pm.getSessionMemory?.(memoryDb);
      if (sessionMemory) {
        sessionMemory.setSessionId(`session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        const projectRoot = pm.MemoryDatabase.getCurrentProjectRoot?.();
        if (projectRoot) sessionMemory.setProjectPath(projectRoot);
        console.log(`[pi-sub] 🧠 Session memory initialized (Project: ${projectRoot})`);
      }
    }
  } catch {
    console.log('[pi-sub] ⚠️ pi-memory not loaded — memory features disabled');
  }

  // Остальная логика — с проверками hasRealDb
  // ... all code that uses memoryDb/sessionMemory guarded by if (hasRealDb) ...
}
```

#### pi-sub/agent-runner.ts

**Сейчас:**
```typescript
import { MemoryDatabase, getSessionMemory, type SessionMemory } from "pi-memory";
```

**Стало:**
```typescript
// Убрать static import

// В runAgent():
async function runAgent(ctx: any, type: string, prompt: string, options: any) {
  let memoryDb: any = null;
  let hasRealDb = false;
  
  try {
    const pm = await import('pi-memory') as any;
    memoryDb = pm.MemoryDatabase?.getInstance?.();
    hasRealDb = !!memoryDb;
  } catch {
    // fallback — нет памяти
  }
  
  // Все места с memoryDb — обернуть в if (hasRealDb)
  // Например:
  if (hasRealDb) {
    try {
      memoryDb.saveSubagentResult({...});
    } catch {}
  }
}
```

#### pi-sub/session-handler.ts

**Сейчас:**
```typescript
import { MemoryDatabase, getSessionMemory, resetSessionMemory, consolidateMemory, type SessionMemory } from "pi-memory";
```

**Стало:**
```typescript
export function registerSessionEvents(pi: any, manager: any, widget: any, memoryDb: any, sessionMemory: any) {
  const hasRealDb = !!memoryDb;
  
  // Все места с memoryDb — обернуть в if (hasRealDb)
  // В session_shutdown:
  if (hasRealDb) {
    try { memoryDb.close(); } catch {}
  }
}
```

#### pi-sub/commands/memory-commands.ts

**Сейчас:**
```typescript
import { consolidateMemory, escapeFts5Query, priorityEmoji } from "pi-memory";
```

**Стало:**
```typescript
// Все функции команд — обернуть в проверку:
// if (!memoryDb) return pi.notify('Memory not available');
// Внутри: const pm = await import('pi-memory') as any;
```

### Этап B: Заменить статические импорты в pi-context-tools (4 runtime файла)

#### pi-context-tools/tools/ctx-bash.ts

**Сейчас:**
```typescript
import { MemoryDatabase, priorityEmoji } from "pi-memory";
```

**Стало:**
```typescript
// memoryDb передаётся как аргумент функции
// priorityEmoji — нужен fallback:
const priorityEmoji = (p: any) => typeof p === 'string' ? p : '•';
```

#### pi-context-tools/tools/ctx-search.ts

**Сейчас:**
```typescript
import { MemoryDatabase, type ToolOutput, type SubagentResult, type SessionFact, ... } from "pi-memory";
```

**Стало:**
```typescript
// memoryDb передаётся как аргумент функции
// Все типы — заменены на any или локальные
```

#### pi-context-tools/tools/ctx-read.ts

**Сейчас:**
```typescript
import { MemoryDatabase, priorityEmoji } from "pi-memory";
```

**Стало:**
```typescript
// memoryDb передаётся как аргумент функции
```

#### pi-context-tools/tools/ctx-stats.ts

**Сейчас:**
```typescript
import { MemoryDatabase } from "pi-memory";
```

**Стало:**
```typescript
// memoryDb передаётся как аргумент функции
```

### Этап C: Обновить package.json

#### pi-sub/package.json

```json
{
  "name": "pi-sub",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": ">=0.74.0",
    "@earendil-works/pi-coding-agent": ">=0.74.0",
    "@earendil-works/pi-tui": ">=0.74.0",
    "pi-memory": ">=0.1.0"
  },
  "dependencies": {
    "pi-memory": "file:../pi-memory"
  },
  "optionalDependencies": {
    "pi-context-tools": "file:../pi-context-tools"
  },
  "devDependencies": {}
}
```

> **Важно:** `pi-memory` в `dependencies` — потому что pi-sub **фактически** использует его API. Если `pi-memory` сломается — pi-sub сломается. Но динамический import + try/catch обеспечит fallback.
> `pi-context-tools` в `optionalDependencies` — потому что pi-sub **не использует** его напрямую.

#### pi-context-tools/package.json

```json
{
  "name": "pi-context-tools",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.74.0",
    "@earendil-works/pi-tui": ">=0.74.0"
  },
  "optionalDependencies": {
    "pi-memory": "file:../pi-memory"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13"
  }
}
```

> `pi-memory` в `optionalDependencies` — чтобы npm создал symlink, но не сломал install если не найден.
}
```

#### pi-sub/session-handler.ts

```typescript
// Убрать: import { MemoryDatabase, getSessionMemory, resetSessionMemory, consolidateMemory } from "pi-memory";

// В registerSessionEvents():
export function registerSessionEvents(pi: any, manager: any, widget: any, memoryDb: any, sessionMemory: any) {
  const hasRealDb = !!memoryDb;
  
  pi.on("session_start", async (event: any, ctx: any) => {
    if (hasRealDb) {
      // Auto-purge
      const stats = memoryDb.getStats();
      if (stats.dbSizeMb > 50 || stats.toolOutputs > 5000) {
        // ... purge ...
      }
      // Auto-consolidation
      if (stats.sessionFacts > 1000) {
        try {
          const pm = await import('pi-memory');
          pm.consolidateMemory?.(memoryDb, { threshold: 0.7 });
        } catch { /* ignore */ }
      }
    }
  });
  
  pi.on("session_shutdown", async () => {
    manager.abortAll();
    manager.dispose();
    
    if (hasRealDb) {
      try { memoryDb.close(); } catch {}
    }
    if (sessionMemory) {
      try {
        const pm = await import('pi-memory');
        pm.resetSessionMemory?.();
      } catch {}
    }
  });
}
```

### Этап D: Обновить package.json

#### pi-sub/package.json

```json
{
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "optionalDependencies": {
    "pi-memory": "file:../pi-memory",
    "pi-context-tools": "file:../pi-context-tools"
  }
}
```

> **Важно:** `optionalDependencies` — npm не сломает установку если модуль не найден.

---

## 4. Матрица поведения (итоговая)

### Все три загружены (default)
```
packages: ["npm:pi-memory", "npm:pi-context-tools", "npm:pi-sub"]
→ Полный функционал: БД, контекстные инструменты, субагенты
```

### Только pi-memory НЕ в packages
```
packages: ["npm:pi-context-tools", "npm:pi-sub"]
→ pi-memory не загружается
→ MemoryDatabase.getInstance() → null (не ошибка!)
→ pi-sub: работает без памяти
→ pi-context-tools: не регистрирует инструменты (нет БД)
→ Стандартные инструменты
```

### Только pi-context-tools НЕ в packages
```
packages: ["npm:pi-memory", "npm:pi-sub"]
→ pi-context-tools не загружается
→ Инструменты НЕ перезаписываются (стандартные остаются)
→ Память работает (pi-memory загружен)
→ Субагенты работают с памятью
```

### Только pi-sub НЕ в packages
```
packages: ["npm:pi-memory", "npm:pi-context-tools"]
→ pi-sub не загружается
→ Субагенты не работают
→ Память работает
→ Контекстные инструменты работают
→ Основной агент использует полный функционал
```

### Все три НЕ в packages
```
packages: []
→ Чистый pi-coding-agent без расширений
```

### pi-memory + pi-context-tools НЕ в packages
```
packages: ["npm:pi-sub"]
→ Субагенты работают без памяти
→ Стандартные инструменты
```

---

## 5. Список файлов для изменения

| # | Файл | Статус | Действие |
|---|------|--------|----------|
| 1 | `agent/settings.json` | ✅ сделано | Добавлены pi-memory и pi-context-tools |
| 2 | `pi-context-tools/index.ts` | ✅ сделано | Сам регистрирует инструменты, проверяет pi-memory |
| 3 | `pi-sub/index.ts` | ✅ сделано | Убран вызов registerContextTools |
| 4 | `pi-memory/database.ts` | ❌ надо | Добавить `getInstance()` → null, `initialize()`, `isInitialized()` |
| 5 | `pi-memory/session-memory.ts` | ❌ надо | `getSessionMemory()` принимать null, возвращать null |
| 6 | `pi-memory/index.ts` | ❌ надо | Использовать `initialize()` вместо `getInstance()` |
| 7 | `pi-context-tools/register-tools.ts` | ❌ надо | Добавить `if (!memoryDb) return;` |
| 8 | `pi-sub/index.ts` | ❌ надо | Static → dynamic import pi-memory |
| 9 | `pi-sub/agent-runner.ts` | ❌ надо | Static → dynamic import pi-memory и pi-context-tools |
| 10 | `pi-sub/session-handler.ts` | ❌ надо | Убрать static import, использовать dynamic import |
| 11 | `pi-sub/package.json` | ❌ надо | Убрать из dependencies, добавить optionalDependencies |

---

## 6. Критические моменты

### 6.1 Async default export

**Вопрос:** Поддерживает ли pi-coding-agent async default export?

**Если да:** `export default async function(pi) { ... }` — работает.

**Если нет:**
```typescript
export default function(pi: any) {
  initAsync(pi).catch(err => {
    console.error('[pi-sub] Init failed:', err);
  });
}

async function initAsync(pi: any) {
  // весь код
}
```

### 6.2 Порядок загрузки

**Больше не важен!** Каждый модуль загружается динамически при необходимости.
Если модуль не доступен — catch → fallback.

### 6.3 Типы

Dynamic import возвращает `any` по умолчанию:

```typescript
const pm = await import('pi-memory') as any;
memoryDb = pm.MemoryDatabase?.getInstance?.();
```

---

## 7. Итог

### Что достигнуто сейчас:
1. ✅ `agent/settings.json` — все три расширения подключены
2. ✅ `pi-context-tools/index.ts` — сам регистрирует инструменты
3. ✅ `pi-sub/index.ts` — убрана регистрация инструментов

### Что осталось сделать:
1. `pi-memory/database.ts` — `getInstance()` → null вместо ошибки
2. `pi-memory/session-memory.ts` — `getSessionMemory()` → null
3. `pi-sub/index.ts` — static → dynamic import
4. `pi-sub/agent-runner.ts` — static → dynamic import
5. `pi-sub/session-handler.ts` — static → dynamic import
6. `pi-sub/package.json` — optionalDependencies
7. `pi-context-tools/register-tools.ts` — проверка memoryDb

### Результат:
- Каждое расширение можно удалить из `packages` — система не сломается
- Fallback-режимы для всех комбинаций
- Нет новых конфигов, нет новых файлов

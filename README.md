# Pi-Sub: Система субагентов с долгосрочной памятью

> Расширение для pi-coding-agent, реализующее систему субагентов, контекстную память и оптимизацию вывода инструментов.

---

## 🎯 Что даёт pi-sub

| Проблема | Решение | Результат |
|----------|---------|-----------|
| **Переполнение контекста** | Большие выводы (>5000 символов) сохраняются в БД | ✅ Контекст остаётся компактным |
| **Потеря информации** | Все выводы индексируются в SQLite + FTS5 | ✅ Поиск через `ctx_search` |
| **Долгие задачи** | Субагенты выполняются в фоне | ✅ Параллельная работа |
| **Забывание между сессиями** | Автоматическое извлечение фактов | ✅ Модель помнит контекст |
| **Зацикливание агентов** | Loop-police детектит повторы | ✅ Экономия токенов |
| **Огромный system prompt** | Кастомный промпт (~300 токенов) | ✅ Быстрый первый ответ |
| **Потеря данных субагентов** | Compact сохраняется для всех агентов | ✅ Полная история работы |


## 🛠 Инструменты

### Переопределённые инструменты (pi-sub)

Все инструменты автоматически сохраняют большие выводы (>5000 символов) в БД.

#### `bash`

```typescript
bash({ command: "npm test", timeout: 30000 })
```

- Если вывод > 5000 символов → сохраняется в БД
- Возвращает summary + ID для поиска

#### `read`

```typescript
read({ path: "src/index.ts", offset: 0, limit: 100 })
```

- Поддержка offset/limit для больших файлов
- Авто-сохранение в БД

#### `grep`

```typescript
grep({ pattern: "TODO", path: "src/", options: "-rn" })
```

- Автоматически исключает `.git`
- Использует `rg` если установлен

#### `find`

```typescript
find({ pattern: "*.ts", path: ".", limit: 1000 })
```

- Автоматически исключает `.git`
- Использует `fdfind` если установлен

#### `ls`

```typescript
ls({ path: ".", options: "-la" })
```

#### `ctx_search` (новый инструмент)

```typescript
ctx_search({ query: "registerCommand", limit: 10 })
ctx_search({ query: "id:42" })  # полный вывод по ID
```

- Полнотекстовый поиск (FTS5) по всем сохранённым выводам
- Поиск по tool_name, args, output, summary
- Специальный запрос `id:<n>` для получения полного вывода
- Группировка keywords по компакциям (одна компакция = одна строка)

### Встроенные инструменты (pi-coding-agent)

#### `write`

```typescript
write({ path: "test.md", content: "# Hello" })
```

#### `edit`

```typescript
edit({ 
  path: "file.ts", 
  edits: [{ oldText: "foo", newText: "bar" }] 
})
```

### Инструменты из других расширений

#### `web_search` (pi-minimal-web)

```typescript
web_search({ query: "pi coding agent", numResults: 3 })
```

#### `fetch_content` (pi-minimal-web)

```typescript
fetch_content({ url: "https://example.com", maxLength: 2000 })
```

---

## ⚙️ Команды

### Управление субагентами (pi-sub)

| Команда | Описание | Параметры |
|---------|----------|-----------|
| `/agent-bg` | Запустить субагент в фоне | `[--no-inject\|--silent] <prompt>` |
| `/agent-steer` | Отправить сообщение работающему субагенту | `<id> <message>` |
| `/agent-result` | Получить результат завершённого субагента | `<id>` |
| `/agent-inject` | Инжектировать результат в контекст родителя | `<id>` |
| `/agent-resume` | Возобновить субагент с новым промптом | `<id> <prompt>` |
| `/agent-view` | Мониторинг вывода в реальном времени (5 мин) | `<id>` |
| `/agent-status` | Статус, tool uses, turns, duration | `<id>` |

**Примеры:**

```bash
/agent-bg проанализируй архитектуру проекта
/agent-bg --no-inject найди все баги в коде
/agent-steer abc123 Сосредоточься на тестах
```

### Управление памятью (pi-sub)

| Команда | Описание | Параметры |
|---------|----------|-----------|
| `/memory-stats` | Статистика БД | - |
| `/memory-search` | Поиск по всем данным | `<query>` |
| `/memory-add` | Добавить факт вручную | `<type> <content>` |
| `/memory-purge` | Очистить старые данные | `[tools=N] [facts=N]` |
| `/memory-test` | Тестовые операции с БД | - |
| `/memory-summaries` | Показать summaries компакции | `[limit]` |
| `/memory-keywords` | Показать ключевые слова компакций | `[query]` |

**Типы фактов:**

- `decision` — решения
- `lesson` — уроки
- `preference` — предпочтения
- `architecture` — архитектурные заметки
- `api` — API детали

**Примеры:**

```bash
/memory-add decision Используем PostgreSQL
/memory-search TypeScript
/memory-purge tools=7 facts=30
/memory-keywords WAL              # Поиск по ключевым словам
/memory-keywords                  # Показать последние ключевые слова
```

### Другие команды

| Команда | Источник | Описание |
|---------|----------|----------|
| `/agents` | pi-sub | Меню выбора типа агента |
| `/loop-police` | loop-police | Управление loop-police |
| `/add_context` | extensions | Отправить контекст модели |

**Примеры loop-police:**

```bash
/loop-police                    # Статус
/loop-police reset all          # Сброс всех состояний
/loop-police set REPEATED_TOOL_CALL_LIMIT=5
```

### Встроенные команды (pi-coding-agent)

| Команда | Описание |
|---------|----------|
| `/login` | Manage OAuth or API-key credentials |
| `/logout` | Manage OAuth or API-key credentials |
| `/model` | Switch models |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session file, ID, messages, tokens, and cost |
| `/tree` | Jump to any point in the session and continue from there |
| `/trust` | Save project trust decision for future sessions |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist |
| `/reload` | Reload keybindings, extensions, skills, prompts |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit pi |

---

## 🔄 Подписки на события (pi.on)

### pi-sub

| Событие | Действие |
|---------|----------|
| `session_start` | Инициализация UI, set session ID |
| `session_before_switch` | Очистка завершённых агентов |
| `session_shutdown` | Abort всех, dispose |
| `tool_execution_start` | Обновление UI виджета |
| `tool_result` | Обрезка вывода до 5KB |
| `session_before_compact` | Извлечение фактов (только для main agent) |
| `before_agent_start` | Кастомный system prompt с memory policy |

**Примечание:** Генерация `detailed_summary` и `meta` происходит в `agent-runner.ts` при событии `compaction_end` для **всех агентов** (main + subagents). Это позволяет сохранять полную историю работы субагентов.

### loop-police

| Событие | Действие |
|---------|----------|
| `agent_start` | Сброс AgentState, новый sessionId |
| `turn_start` | Сброс счётчиков цикла |
| `message_update` | Мониторинг thinking-блока (character loops) |
| `message_end` | Анализ semantic loops, tool loops |
| `tool_call` | Отслеживание repeated tool calls |

**Детекция зацикливания:**

- Character-level loops (повторяющиеся символы, порог: 80 символов)
- Semantic loops (повторяющиеся мысли, similarity > 0.7)
- Tool loops (одинаковые вызовы инструментов подряд, порог: 3)
- Stagnation (отсутствие прогресса за 5 ходов, similarity > 0.85)
- File read limits (лимит 5 чтений файлов за 600 секунд)

### web-search-guidance

| Событие | Действие |
|---------|----------|
| `agent_start` | Сброс предупреждений |
| `tool_call` | Валидация web_search (numResults ≤ 2) |
| `tool_call` | Валидация fetch_content (maxLength ≤ 1000, offset) |
| `tool_result` | Обновление состояния для детекции offset |

**Автообучение:** Если модель 3+ раза подряд правильно использует инструмент — проверки отключаются.

---

## ⏱️ Фоновые процессы

| Процесс | Период | Действие |
|---------|--------|----------|
| AgentManager cleanup | 60 сек | Очистка завершённых агентов |
| AgentWidget update | 80 мс | Обновление виджета статуса |
| Agent status polling | 1 сек / 500 мс | Мониторинг вывода / статуса |
| Web search retry | 1 сек | Exponential backoff при rate limiting |
| Content fetch timeout | Настраиваемый | Отмена запроса через AbortController |

---

## 🧠 Система памяти

### Архитектура БД

```
.pi/memory/unified.db (SQLite + WAL mode)
│
├── tool_outputs
│   ├── id, tool_name, args, output, summary, timestamp, size
│   └── FTS5 index (tool_outputs_fts)
│
├── subagent_results
│   ├── id, agent_type, description, result, status, tool_uses, duration_ms, timestamp
│   └── FTS5 index (subagent_results_fts)
│
├── session_facts
│   ├── id, session_id, fact_type, content, timestamp
│   └── FTS5 index (session_facts_fts)
│
├── compaction_summaries
│   ├── id, session_id, reason, tokens_before, summary, detailed_summary, timestamp
│   └── FTS5 index (compaction_summaries_fts)
│
├── compressed_results
│   ├── id, original_hash, compressed, timestamp
│   └── FTS5 index (compressed_results_fts)
│
└── compaction_keywords (нормализованные ключевые слова)
    ├── id, compaction_id, keyword, category, timestamp
    ├── category: file | decision | lesson
    └── FTS5 index (compaction_keywords_fts)
```

### Как модель получает данные в новой сессии

Есть **3 механизма** доступа к памяти:

#### 1. Автоматическая инъекция фактов (пассивный)

При запуске **субагента** в system prompt инжектируются релевантные факты из `session_facts`:

```
# Session Memory
Relevant context from previous sessions:
- 🎯 [decision] Используем PostgreSQL для хранения данных
- 💡 [lesson] Не использовать any в TypeScript
- ⭐ [preference] Предпочитаю функциональный стиль
```

**Ограничение:** Только `session_facts`, максимум 5 фактов.

#### 2. Memory Policy в system prompt (подсказка)

При старте **каждого агента** в system prompt добавляется подсказка:

```
## Context Preservation
Large outputs (>5000 chars) from bash, read, grep, find, ls are auto-saved to SQLite DB.
Use ctx_search to retrieve full saved output or search past results.
Memory contains: decisions, lessons, preferences, architecture notes, API details.
```

#### 3. Прямой поиск через `ctx_search` (активный)

Модель **сама решает** когда искать информацию:

```typescript
// Поиск по ключевым словам
ctx_search({ query: "PostgreSQL" })

// Поиск по ID (полный вывод)
ctx_search({ query: "id:42" })

// Поиск по ключевым словам компакций
ctx_search({ query: "WAL mode" })
```

**Что ищет:** По **ВСЕМ** таблицам с FTS5:
- `tool_outputs` — прошлые выводы bash/read/grep/find/ls
- `subagent_results` — результаты прошлых субагентов
- `session_facts` — извлечённые факты
- `compaction_summaries` — summaries компакций (main + subagents)
- `compressed_results` — сжатые результаты
- `compaction_keywords` — нормализованные ключевые слова (main + subagents)

### Поиск корневого `.pi`

БД всегда создаётся в **корневом** `.pi/memory/`, даже если проект открыт в поддиректории:

```
/home/user/project/
├── .pi/
│   └── memory/
│       └── unified.db  ← БД здесь
└── src/
    └── file.ts

Если открыть /home/user/project/src/ → БД всё равно в /home/user/project/.pi/memory/
```

### Извлечение фактов

**Паттерны:**

```typescript
decision: "решение", "выбрали", "decided to", "решили"
lesson: "важно", "запомни", "mistake", "ошибка"
preference: "предпочитаю", "хочу", "лучше"
architecture: "архитектура", "структура", "модуль"
api: "endpoint", "route", "auth", "API"
```

**Процесс:**

1. Перед `session_before_compact` анализируются сообщения (только main agent)
2. Применяются regex-паттерны
3. Фильтрация по длине (20-500 символов)
4. Проверка дубликатов (hash)
5. Сохранение в `session_facts`

### Компакции для всех агентов (Phase 6)

При компакции контекста **любого агента** (main или subagent) автоматически:

1. **Генерируется `detailed_summary`** — структурированный дамп с решениями, файлами, кодом
2. **Извлекаются ключевые слова** — файлы, решения, уроки
3. **Сохраняется в БД** — `compaction_summaries` + `compaction_keywords`

**Где генерируется:** В `agent-runner.ts` при событии `compaction_end` — это гарантирует, что данные создаются для всех агентов, включая субагентов.

**Утилита:** `context-tools/utils/compaction-summary.ts` — переиспользуемая функция `generateCompactionDetailedSummary()`.

### Нормализованные ключевые слова компакций

При компакции контекста автоматически извлекаются ключевые слова:

**Категории:**
- `file` — файлы, которые читались/писались (например, `database.ts`, `ctx-search.ts`)
- `decision` — принятые решения (например, `use WAL mode`, `FTS5 search`)
- `lesson` — извлечённые уроки (например, `check null before access`)

**Преимущества:**
- FTS5 индексирует **каждое ключевое слово отдельно**
- Можно искать по категории: `category:decision AND WAL`
- Нет дублирования — только ссылки на `compaction_summaries`
- Масштабируемо — можно добавить миллионы ключевых слов
- **Работает для всех агентов** (main + subagents)

**Пример поиска:**

```bash
# Найти все компакции, где работали с database.ts
ctx_search "database.ts"

# Найти все решения про WAL
/memory-keywords WAL

# Получить полный detailed_summary
ctx_search "id:42"

# Найти компакции субагента research
/memory-keywords research
```

### Инжекция в промпт

При запуске субагента:

```typescript
const relevantFacts = sessionMemory.getRelevantFacts(prompt, 5);
const memoryBlock = `# Session Memory\n${relevantFacts.join("\n")}`;
// Инжектируется в system prompt субагента
```

---

## 🏗 Архитектура

### Структура файлов

```
pi-sub/
├── index.ts                    # Точка входа, инициализация
├── agent-manager.ts            # Управление жизненным циклом
├── agent-runner.ts             # Ядро выполнения + генерация compaction summary
├── agent-types.ts              # Реестр типов агентов
├── custom-agents.ts            # Загрузка из .pi/agents/
├── default-agents.ts           # Встроенные агенты
├── prompts.ts                  # Сборка системных промптов
├── commands/
│   ├── agent-commands.ts       # /agent-* команды
│   ├── memory-commands.ts      # /memory-* команды
│   └── agents-menu.ts          # /agents
├── tools/
│   └── register-tools.ts       # Переопределение инструментов
├── memory/
│   ├── database.ts             # SQLite + FTS5
│   ├── session-memory.ts       # Извлечение фактов
│   └── result-compressor.ts    # Сжатие результатов
├── context-tools/
│   ├── ctx-bash.ts             # bash с сохранением
│   ├── ctx-read.ts             # read с сохранением
│   ├── ctx-search.ts           # ctx_search (FTS5)
│   └── utils/
│       ├── analyzers.ts        # Анализаторы вывода
│       ├── summary.ts          # Генерация summary
│       └── compaction-summary.ts # Генерация detailed_summary + meta (Phase 6)
├── ui/
│   └── agent-widget.ts         # Виджет статуса (80ms)
└── renderers/
    └── message-renderers.ts    # Кастомный рендеринг
```

### Жизненный цикл субагента

```
/agent-bg <prompt>
    │
    ▼
AgentManager.spawn()
    ├── Создаёт AgentRecord (id, type, status="queued")
    ├── Если running < maxConcurrent → запускает сразу
    └── Иначе → добавляет в очередь
    │
    ▼
AgentRunner.runAgent()
    ├── Создаёт сессию (createAgentSession)
    ├── Собирает system prompt (prompts.ts)
    │   ├── Инжекция memoryBlock (факты из session memory)
    │   └── Кастомный промпт с memory policy
    ├── Запускает agent loop
    │   ├── LLM вызывает инструменты
    │   ├── Инструменты сохраняют большие выводы в БД
    │   └── При compaction_end → генерирует detailed_summary + meta (Phase 6)
    └── Собирает результат
    │
    ▼
onComplete callback
    ├── Сохраняет результат в subagent_results
    ├── Если !noInject → инжектирует в родителя
    └── Обновляет UI виджет
    │
    ▼
onCompact callback (Phase 6)
    ├── Сохраняет summary + detailed_summary в compaction_summaries
    └── Сохраняет keywords в compaction_keywords
```

### Типы агентов

**Встроенные:**

- `coding` — кодирование (write, edit, bash)
- `readonly` — только чтение (read, grep, find, ls)
- `memory` — работа с памятью (read, write, edit)
- `research` — исследование (bash, grep, find)

**Пользовательские** (`.pi/agents/*.md`):

- name, description, systemPrompt
- model, thinking, maxTurns
- tools (builtinToolNames, disallowedTools)
- extensions, skills
- isolation (worktree)

**Параллелизм:**

- Максимум 4 одновременных субагента
- Очередь для остальных
- Автоматическая очистка завершённых (каждые 60 сек)

---

## 🔍 Отладка

### Просмотр БД

```bash
# Размер БД
ls -lh .pi/memory/unified.db

# Количество записей
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM tool_outputs;"
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM subagent_results;"
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM session_facts;"
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM compaction_keywords;"
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM compaction_summaries;"

# Последние записи
sqlite3 .pi/memory/unified.db "SELECT id, tool_name, size FROM tool_outputs ORDER BY timestamp DESC LIMIT 5;"

# Статистика ключевых слов
sqlite3 .pi/memory/unified.db "SELECT category, COUNT(*) FROM compaction_keywords GROUP BY category;"

# Компакции по агентам (Phase 6)
sqlite3 .pi/memory/unified.db "SELECT id, reason, tokens_before, length(detailed_summary) as detailed_len FROM compaction_summaries ORDER BY timestamp DESC LIMIT 5;"
```

### Логи

```
[pi-sub] 📦 Memory database initialized. Tool outputs: 42, Subagent results: 5, Session facts: 12, Compaction keywords: 156, Size: 12.5 MB
[pi-sub] 🧠 Session memory initialized (ID: session-1234567890-abc123)
[pi-sub] 📦 Generated compaction summary for agent abc123: 47 msgs, 5234 chars, 8 files, 3 decisions, 2 lessons
[pi-sub] 💾 Saved compaction summary (ID: 42, agent: research, 18432 tokens, 1234 chars summary, 5234 chars detailed)
[pi-sub] 🔑 Saved 13 keywords for compaction 42 (8 files, 3 decisions, 2 lessons)
[pi-sub] 🔇 Agent abc123: no-inject mode — showing result in UI only
[pi-sub] ✂️ Truncated large tool output to prevent context overflow
```

### Тестирование инструментов

```bash
# Большой вывод (должен сохраниться в БД)
bash "seq 1 10000"

# Поиск по сохранённым
ctx_search "seq"

# Получить полный вывод
ctx_search "id:1"

# Поиск по ключевым словам
/memory-keywords WAL

# Тест всех операций
/memory-test
```

---

## 📝 Разработка

### Добавление нового инструмента

```typescript
// tools/register-tools.ts
pi.registerTool(defineTool({
  name: "my_tool",
  label: "My Tool",
  description: "Описание инструмента",
  parameters: Type.Object({
    param1: Type.String(),
  }),
  
  renderCall(args, theme) {
    return new Text("▸ " + theme.fg("toolTitle", theme.bold("my_tool")), 0, 0);
  },
  
  renderResult(result, opts, theme) {
    return renderSavedToDb(result, opts, theme, "running");
  },
  
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    const result = await doSomething(params.param1);
    return { content: [{ type: "text", text: result }] };
  },
}));
```

### Добавление новой команды

```typescript
// commands/my-commands.ts
pi.registerCommand("mycommand", {
  description: "Описание команды",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Hello ${args || "world"}!`, "info");
  },
});
```

### Добавление подписки на событие

```typescript
// index.ts
pi.on("tool_call", (event, ctx) => {
  if (event.toolName === "bash") {
    console.log("Bash called:", event.input.command);
  }
});
```

---

## 📦 Зависимости

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| `better-sqlite3` | ^11.8.2 | SQLite база данных |
| `@earendil-works/pi-coding-agent` | >=0.74.0 | API расширения (peer) |
| `@earendil-works/pi-tui` | * | TUI компоненты (peer) |
| `@sinclair/typebox` | ^0.34.33 | Схемы параметров |
| `nanoid` | ^5.1.5 | Генерация ID |

---

## 📊 Статистика

| Категория | Количество |
|-----------|------------|
| Переопределённые инструменты | 5 (bash, read, grep, find, ls) |
| Новые инструменты | 1 (ctx_search) |
| Команды pi-sub | 14 |
| События pi-sub | 7 |
| События loop-police | 5 |
| Фоновые процессы | 5 |
| Таблицы БД | 6 |
| FTS5 индексов | 6 |

---

## 📖 Источники

- **Исходный код**: `~/.pi/agent/npm/pi-sub/`
- **Документация pi**: `~/.nvm/versions/node/v22.23.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
- **Примеры**: `~/.nvm/versions/node/v22.23.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/`

---

## 🎯 Ключевые оптимизации

1. **Экономия токенов**: Убраны descriptions из параметров инструментов (~100 токенов)
2. **Кастомный system prompt**: ~300 токенов вместо ~2400 (экономия 88%)
3. **Контекст-сохраняющие инструменты**: Большие выводы не забивают контекст
4. **FTS5 поиск**: Мгновенный поиск по всем сохранённым выводам
5. **Нормализованные ключевые слова**: Точный поиск по решениям, урокам, файлам
6. **Компакции для всех агентов**: detailed_summary и keywords сохраняются для main + subagents
7. **Автоматическая память**: Факты извлекаются без участия пользователя
8. **Параллелизм**: До 4 субагентов одновременно
9. **Loop detection**: Защита от зацикливания и бесконечных циклов
10. **Динамические пути**: БД всегда в корневом `.pi/memory/`
11. **Группировка результатов**: Keywords группируются по компакциям в ctx_search
12. **Увеличенный preview**: 500 символов для detailed_summary вместо 150
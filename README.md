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

---

## 🚀 Быстрый старт

```bash
# Установка
cd ~/.pi/agent/npm/pi-sub
npm install

# Запуск субагента
/agent-bg проанализируй структуру проекта

# Без инжекта результата
/agent-bg --no-inject найди все TODO

# Поиск по сохранённым выводам
ctx_search "registerCommand"
ctx_search "id:42"  # полный вывод по ID
```

---

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
ctx_search({ query: "id:42" })  // полный вывод по ID
```

- Полнотекстовый поиск (FTS5) по всем сохранённым выводам
- Поиск по tool_name, args, output, summary
- Специальный запрос `id:<n>` для получения полного вывода

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
| `/agent-inject` | Инжектить результат в контекст родителя | `<id>` |
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
| `/memory-search` | Поиск по фактам из сессий | `<query>` |
| `/memory-add` | Добавить факт вручную | `<type> <content>` |
| `/memory-purge` | Очистить старые данные | `[tools=N] [facts=N]` |
| `/memory-test` | Тестовые операции с БД | - |
| `/memory-summaries` | Показать summaries компакции | `[limit]` |

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
| `tool_result` | Обрезка вывода до 50KB |
| `session_before_compact` | Извлечение фактов + генерация detailed_summary |
| `before_agent_start` | Кастомный system prompt с memory policy |

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
└── compressed_results
    ├── id, original_hash, compressed, timestamp
    └── FTS5 index (compressed_results_fts)
```

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

1. Перед `session_before_compact` анализируются сообщения
2. Применяются regex-паттерны
3. Фильтрация по длине (20-500 символов)
4. Проверка дубликатов (hash)
5. Сохранение в `session_facts`

### Инжекция в промпт

При запуске субагента:

```typescript
const relevantFacts = sessionMemory.getRelevantFacts(prompt, 5);
const memoryBlock = `# Session Memory\n${relevantFacts.join("\n")}`;
// Инжектится в system prompt субагента
```

---

## 🏗 Архитектура

### Структура файлов

```
pi-sub/
├── index.ts                    # Точка входа, инициализация
├── agent-manager.ts            # Управление жизненным циклом
├── agent-runner.ts             # Ядро выполнения
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
│       └── summary.ts          # Генерация summary
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
    │   └── Инструменты сохраняют большие выводы в БД
    └── Собирает результат
    │
    ▼
onComplete callback
    ├── Сохраняет результат в subagent_results
    ├── Если !noInject → инжектит в родителя
    └── Обновляет UI виджет
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

# Последние записи
sqlite3 .pi/memory/unified.db "SELECT id, tool_name, size FROM tool_outputs ORDER BY timestamp DESC LIMIT 5;"
```

### Логи

```
[pi-sub] 📦 Memory database initialized. Tool outputs: 42, Subagent results: 5, Session facts: 12, Size: 12.5 MB
[pi-sub] 🧠 Session memory initialized (ID: session-1234567890-abc123)
[pi-sub] 🗜️ Agent abc123: compressed (5000 → 950 chars)
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
| Команды pi-sub | 13 |
| События pi-sub | 7 |
| События loop-police | 5 |
| Фоновые процессы | 5 |

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
5. **Автоматическая память**: Факты извлекаются без участия пользователя
6. **Параллелизм**: До 4 субагентов одновременно
7. **Loop detection**: Защита от зацикливания и бесконечных циклов
8. **Динамические пути**: БД всегда в корневом `.pi/memory/`
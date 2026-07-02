# Pi Commands & Tools & Background Processes Documentation

> Автоматически сгенерированный документ по всем командам, инструментам и фоновым процессам pi.
> Последнее обновление: 2026-07-02

---

## 🛠 Инструменты (Tools)

Инструменты — это функции, доступные LLM-модели для выполнения действий (чтение файлов, bash, поиск и т.д.).

### 📦 Встроенные инструменты (pi-coding-agent)

Базовые инструменты, идущие с pi по умолчанию:

#### `/bash`
- **Описание:** Выполнить bash-команду с сохранением контекста
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `command` | `string` | Bash-команда для выполнения (обязательный) |
  | `timeout` | `number` | Таймаут в секундах (необязательный) |
- **Пример:** `bash({ command: "ls -la", timeout: 30 })`

#### `/read`
- **Описание:** Читать содержимое файла с сохранением контекста
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `path` | `string` | Путь к файлу (относительный или абсолютный) |
  | `offset` | `number` | Номер строки для начала чтения (1-indexed) |
  | `limit` | `number` | Максимальное количество строк для чтения |
- **Пример:** `read({ path: "README.md", offset: 1, limit: 100 })`

#### `/write`
- **Описание:** Записать/создать файл с указанным содержимым
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `path` | `string` | Путь к файлу (относительный или абсолютный) |
  | `content` | `string` | Содержимое для записи в файл |
- **Пример:** `write({ path: "test.md", content: "# Hello" })`

#### `/edit`
- **Описание:** Точечная замена текста в файле
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `path` | `string` | Путь к файлу для редактирования |
  | `edits` | `array` | Массив объектов замены |
  | `edits[].oldText` | `string` | Точный текст для замены (должен быть уникальным) |
  | `edits[].newText` | `string` | Заменяющий текст |
- **Пример:** `edit({ path: "file.ts", edits: [{ oldText: "foo", newText: "bar" }] })`

#### `/grep`
- **Описание:** Поиск паттерна в содержимом файлов
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `pattern` | `string` | Паттерн поиска (regex или строка) |
  | `path` | `string` | Директория или файл для поиска (по умолчанию: cwd) |
  | `glob` | `string` | Фильтр файлов по glob-паттерну (например, '*.ts') |
  | `ignoreCase` | `boolean` | Без учёта регистра (по умолчанию: false) |
  | `literal` | `boolean` | Буквальная строка вместо regex (по умолчанию: false) |
  | `context` | `number` | Строк до и после каждого совпадения (по умолчанию: 0) |
  | `limit` | `number` | Максимум совпадений (по умолчанию: 100) |
- **Пример:** `grep({ pattern: "hello", path: "src/", glob: "*.ts", limit: 50 })`

#### `/find`
- **Описание:** Поиск файлов по glob-паттерну
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `pattern` | `string` | Glob-паттерн (например, '*.ts', '**/*.json') |
  | `path` | `string` | Директория для поиска (по умолчанию: cwd) |
  | `limit` | `number` | Максимум результатов (по умолчанию: 1000) |
- **Пример:** `find({ pattern: "**/*.ts", limit: 500 })`

#### `/ls`
- **Описание:** Список содержимого директории
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `path` | `string` | Директория для списка (по умолчанию: cwd) |
  | `limit` | `number` | Максимум записей (по умолчанию: 500) |
- **Пример:** `ls({ path: "/home/user", limit: 100 })`

---

### 🔧 Кастомные инструменты (из расширений)

#### Из `pi-sub` (переопределяет встроенные + добавляет новые):

##### `/ctx_search`
- **Описание:** Полнотекстовый поиск по сохранённым результатам инструментов (FTS5)
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `query` | `string` | Строка поиска (обязательный) |
  | `limit` | `number` | Максимум результатов |
- **Пример:** `ctx_search({ query: "registerCommand", limit: 20 })`

> **Примечание:** Инструменты `bash`, `read`, `grep`, `find`, `ls` из pi-sub **переопределяют** встроенные версии. Они добавляют автоматическое сохранение больших результатов в базу данных и замену на превью.

#### Из `pi-minimal-web`:

##### `/web_search`
- **Описание:** Поиск в интернете через Exa
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `query` | `string` | Запрос для поиска (обязательный) |
  | `numResults` | `number` | Количество результатов (по умолчанию: 1, макс: 5) |
  | `offset` | `number` | Смещение для пагинации (по умолчанию: 0) |
- **Пример:** `web_search({ query: "pi coding agent", numResults: 3 })`

##### `/fetch_content`
- **Описание:** Получить содержимое URL как markdown
- **Параметры:**
  | Параметр | Тип | Описание |
  |----------|------|----------|
  | `url` | `string` | URL для загрузки (обязательный) |
  | `maxLength` | `number` | Максимальная длина результата (по умолчанию: 1000, макс: 10000) |
  | `offset` | `number` | Смещение (по умолчанию: 0) |
- **Пример:** `fetch_content({ url: "https://example.com", maxLength: 2000 })`

---

## ⚙️ Фоновые процессы и подписки на события

### 📊 Подписки на события (pi.on)

#### 1. loop-police (`~/.pi/agent/npm/loop-police/extensions/loop-police.ts`)

**Назначение:** Обнаружение зацикливания агента (loop detection) и предотвращение бесконечных циклов.

| Событие | Описание |
|---------|----------|
| `agent_start` | Сброс состояния агента при старте нового агента. Определяет sessionId и сбрасывает AgentState. |
| `turn_start` | Сброс счётчиков при начале нового хода (turn). Инициализация state.lastCheckedLen, state.thinkingAborted. |
| `message_update` | Мониторинг длины сообщения в реальном времени. Отслеживание thinking-блока для обнаружения character-level loops (повторяющиеся символы). |
| `message_end` | Проверка на loop после завершения сообщения. Анализ на repeating patterns, semantic loops (повторяющиеся мысли). |
| `tool_call` | Отслеживание истории вызовов инструментов. Обнаружение repeated tool calls (одни и те же инструменты подряд). Анализ tool sequence (последовательности вызовов). |

**Мониторинг:**
- **Character-level loops:** Повторяющиеся символы в thinking-блоке (порог: 80 символов)
- **Semantic loops:** Повторяющиеся мысли/параграфы (порог: 3 совпадения, similarity 0.7)
- **Tool loops:** Повторяющиеся вызовы инструментов (порог: 3 одинаковых инструмента подряд)
- **Stagnation detection:** Отсутствие прогресса за 5 ходов (similarity > 0.85)
- **File read limits:** Лимит 5 чтений файлов за 600 секунд

---

#### 2. pi-sub (`~/.pi/agent/npm/pi-sub/index.ts`)

**Назначение:** Управление субагентами, UI виджетов, сжатие контекста, кастомный системный промпт.

| Событие | Описание |
|---------|----------|
| `session_start` | Инициализация UI виджета, очистка завершённых агентов, обновление Session ID для session memory. |
| `session_before_switch` | Очистка завершённых агентов перед переключением сессии. |
| `session_shutdown` | Отмена всех агентов (`manager.abortAll()`), освобождение ресурсов (`manager.dispose()`). |
| `tool_execution_start` | Обновление UI виджета, вызов `widget.onTurnStart()` для начала нового хода. |
| `tool_result` | **Ограничение размера вывода инструментов** — обрезка результатов до 50KB для предотвращения переполнения контекста. |
| `session_before_compact` | **Автоматическое извлечение фактов** — сохранение фактов из сообщений перед сжатием контекста в session memory. |
| `before_agent_start` | **Кастомный системный промпт** — внедрение memory policy и правил работы с памятью в системный промпт. |

---

#### 3. web-search-guidance (`~/.pi/agent/extensions/web-search-guidance.ts`)

**Назначение:** Автоматическое обучение модели правильному использованию web_search и fetch_content.

| Событие | Описание |
|---------|----------|
| `agent_start` | Сброс счётчиков предупреждений для всех инструментов. |
| `tool_call` | **Валидация web_search:** Блокировка при numResults > 2 (по умолчанию 2). **Автообучение:** после 3+ правильных вызовов подряд — отключение проверок. |
| `tool_call` | **Валидация fetch_content:** Блокировка при maxLength > 1000 без offset. Блокировка при offset > 0 если весь контент уже получен. Блокировка при увеличении maxLength без offset. |
| `tool_result` | Отслеживание результатов fetch_content (returnedLength, totalLength) для детекции необходимости offset. |

**Автообучение:** Если модель 3+ раза подряд правильно использует инструмент — проверки отключаются автоматически.

---

### ⏱️ Фоновые процессы (таймеры/интервалы)

#### 1. AgentManager cleanup (`~/.pi/agent/npm/pi-sub/agent-manager.ts`)
- **Период:** Каждые **60 секунд**
- **Действие:** Очистка завершённых записей агентов из `agents` map
- **Статус:** `unref()` — не блокирует выход процесса

#### 2. AgentWidget update (`~/.pi/agent/npm/pi-sub/ui/agent-widget.ts`)
- **Период:** Каждые **80 миллисекунд**
- **Действие:** Обновление виджета статуса субагентов в TUI
- **Механизм:** Показывает статус всех активных субагентов, скрывает завершённые после 1 хода (ошибочные — после 2)

#### 3. Agent status polling (`~/.pi/agent/npm/pi-sub/commands/agent-commands.ts`)
- **Период:** Каждые **1 секунда** (мониторинг вывода)
- **Период:** Каждые **500 миллисекунд** (проверка статуса)
- **Таймаут:** **5 минут** (300000 мс) — авто-таймаут мониторинга
- **Действие:** Мониторинг активности фонового агента, вывод изменений в реальном времени

#### 4. Web search retry (`~/.pi/agent/npm/pi-minimal-web/exa.ts`)
- **Задержка:** **1 секунда** между попытками при rate limiting
- **Действие:** Exponential backoff при превышении лимитов API

#### 5. Content fetch timeout (`~/.pi/agent/npm/pi-minimal-web/extract.ts`)
- **Таймаут:** Настраиваемый (через параметр `timeoutMs`)
- **Действие:** Отмена запроса через AbortController по таймауту

---

### 🗄️ Фоновая база данных

#### SQLite Memory Database (`~/.pi/agent/npm/pi-sub/memory/database.ts`)
- **Путь:** `.pi/memory/unified.db` (в корне проекта)
- **Режим:** WAL (Write-Ahead Logging) для параллельного доступа
- **FTS5:** Полнотекстовый поиск по сохранённым результатам
- **Таблицы:**
  - `tool_outputs` — результаты инструментов (bash, read, grep, find, ls)
  - `subagent_results` — результаты субагентов
  - `session_facts` — извлечённые факты из сессий
  - `compressed_results` — кэш сжатых результатов

---

### 🔄 Контекст Bash (`~/.pi/agent/npm/pi-sub/context-tools/ctx-bash.ts`)
- **Threshold:** 5000 символов — порог для сохранения в БД
- **Таймаут:** 30 секунд
- **Max buffer:** 10MB
- **Действие:** При выводе > 5000 символов — полное сохранение в БД, пользователю показывается превью + ID

---

### 🗜️ Сжатие результатов (`~/.pi/agent/npm/pi-sub/memory/result-compressor.ts`)
- **Threshold:** 2000 символов — результаты меньше не сжимаются
- **Max compressed:** 1000 символов — максимальная длина сжатого результата
- **Стратегия:**
  1. Проверка кэша (по SHA256 хешу)
  2. LLM-сжатие (прямой вызов)
  3. Fallback на эвристическое сжатие

---

## 📋 Встроенные команды (pi-coding-agent)

Команды, доступные по умолчанию в pi без расширений:

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
| `/compact [prompt]` | Manually compact context, optionally with custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, and context files |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit pi |

---

## 🔧 Команды из `~/.pi/agent/extensions/`

### add_context.ts

#### `/add_context`
- **Описание:** Отправить контекст модели (приостанавливает текущую работу)
- **Параметры:** `<text>` — текст контекста
- **Пример:** `/add_context Вот важный контекст для модели`

---

## 📦 Команды из `~/.pi/agent/npm/pi-sub/`

### agent-commands.ts (7 команд)

#### `/agent-bg`
- **Описание:** Запустить субагент в фоне
- **Параметры:** `[--no-inject] <prompt>`
- **Пример:** `/agent-bg --no-inject проанализируй код`

#### `/agent-steer`
- **Описание:** Управление субагентом
- **Параметры:** нет

#### `/agent-result`
- **Описание:** Получить результат субагента
- **Параметры:** нет

#### `/agent-inject`
- **Описание:** Ввести текст в субагент
- **Параметры:** нет

#### `/agent-resume`
- **Описание:** Возобновить субагент
- **Параметры:** нет

#### `/agent-view`
- **Описание:** Просмотр субагента
- **Параметры:** нет

#### `/agent-status`
- **Описание:** Статус субагента
- **Параметры:** нет

### memory-commands.ts (5 команд)

#### `/memory-stats`
- **Описание:** Статистика памяти
- **Параметры:** нет

#### `/memory-test`
- **Описание:** Тест памяти
- **Параметры:** нет

#### `/memory-purge`
- **Описание:** Очистка памяти
- **Параметры:** нет

#### `/memory-search`
- **Описание:** Поиск в памяти
- **Параметры:** нет

#### `/memory-add`
- **Описание:** Добавить в память
- **Параметры:** нет

### agents-menu.ts (1 команда)

#### `/agents`
- **Описание:** Меню агентов
- **Параметры:** нет

---

## 📦 Команды из `~/.pi/agent/npm/loop-police/`

### loop-police.ts (1 команда)

#### `/loop-police`
- **Описание:** Статус; `/loop-police reset [all|<sessionId>]`; `/loop-police set KEY=VAL`
- **Параметры:** `[reset [all|<sessionId>]]` или `[set KEY=VAL [KEY=VAL ...]]`
- **Пример:** `/loop-police reset all`

---

## 📊 Итого

| Категория | Количество |
|-----------|------------|
| Встроенные инструменты | 7 |
| Кастомные инструменты | 3 |
| Встроенные команды | 23 |
| Команды из extensions | 1 |
| Команды из pi-sub | 13 |
| Команды из loop-police | 1 |
| **Всего** | **48** |

| Фоновые процессы | Период |
|-----------------|--------|
| AgentManager cleanup | 60 секунд |
| AgentWidget update | 80 миллисекунд |
| Agent status polling | 1 сек (вывод) / 500 мс (статус) |
| Web search retry | 1 секунда |

| Подписки на события | Источник |
|-------------------|----------|
| 5 событий | loop-police |
| 7 событий | pi-sub |
| 4 события | web-search-guidance |
| **Всего** | **16** |

---

## 📝 Как добавить свою команду или инструмент

### Команда
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("mycommand", {
    description: "Описание команды",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

### Инструмент
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "mytool",
    label: "My Tool",
    description: "Описание инструмента",
    parameters: Type.Object({
      param1: Type.String(),
      param2: Type.Optional(Type.Number()),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: "Результат" }],
      };
    },
  }));
}
```

### Подписка на событие
```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", (event, ctx) => {
    console.log("Agent started!", event);
  });
  
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "bash") {
      console.log("Bash called:", event.input.command);
    }
  });
}
```

---

## 📖 Источники

- Встроенные инструменты: `pi-coding-agent/dist/core/tools/` (bash.js, read.js, write.js, edit.js, grep.js, find.js, ls.js)
- Встроенные команды: `pi-coding-agent/docs/usage.md`
- Команды extensions: `grep -rn "registerCommand" ~/.pi/agent/extensions/`
- Команды pi-sub: `grep -rn "registerCommand" ~/.pi/agent/npm/pi-sub/`
- Команды loop-police: `grep -rn "registerCommand" ~/.pi/agent/npm/loop-police/`
- Инструменты pi-sub: `~/.pi/agent/npm/pi-sub/tools/register-tools.ts`
- Инструменты pi-minimal-web: `~/.pi/agent/npm/pi-minimal-web/index.ts`
- Подписки loop-police: `~/.pi/agent/npm/loop-police/extensions/loop-police.ts`
- Подписки pi-sub: `~/.pi/agent/npm/pi-sub/index.ts`
- Подписки web-search-guidance: `~/.pi/agent/extensions/web-search-guidance.ts`
- AgentManager: `~/.pi/agent/npm/pi-sub/agent-manager.ts`
- AgentWidget: `~/.pi/agent/npm/pi-sub/ui/agent-widget.ts`
- AgentCommands: `~/.pi/agent/npm/pi-sub/commands/agent-commands.ts`
- Memory DB: `~/.pi/agent/npm/pi-sub/memory/database.ts`
- Ctx Bash: `~/.pi/agent/npm/pi-sub/context-tools/ctx-bash.ts`
- Result Compressor: `~/.pi/agent/npm/pi-sub/memory/result-compressor.ts`


# Архитектура pi-sub

## 📐 Обзор

`pi-sub` — это расширение для pi-coding-agent, реализующее систему субагентов с долгосрочной памятью. Работает как расширение, которое перехватывает события pi, переопределяет инструменты и добавляет команды.

---

## 🏗 Структура файлов

```
pi-sub/
├── index.ts                    # Точка входа, инициализация
├── agent-manager.ts            # Управление жизненным циклом агентов
├── agent-runner.ts             # Ядро выполнения: создание сессий, запуск агентов
├── agent-types.ts              # Реестр типов агентов (встроенные + пользовательские)
├── custom-agents.ts            # Загрузка пользовательских агентов из .pi/agents/
├── default-agents.ts           # Встроенные агенты по умолчанию
├── prompts.ts                  # Сборка системных промптов
├── context.ts                  # Контекст для передачи между агентами
├── env.ts                      # Определение окружения (git, платформа)
├── settings.ts                 # Управление настройками
├── usage.ts                    # Учёт токенов и стоимости
├── status-note.ts              # Статус-нотификации
├── invocation-config.ts        # Конфигурация запуска агентов
├── helpers/activity-tracker.ts # Трекер активности
├── types.ts                    # Типы (AgentConfig, AgentRecord, и т.д.)
├── types/pi-sub-context.ts     # Контекст для субагентов
├── commands/
│   ├── agent-commands.ts       # /agent-bg, /agent-steer, /agent-result...
│   ├── memory-commands.ts      # /memory-stats, /memory-add, /memory-search...
│   └── agents-menu.ts          # /agents — меню выбора агентов
├── tools/
│   └── register-tools.ts       # Переопределение bash/read/grep/find/ls + ctx_search
├── renderers/
│   └── message-renderers.ts    # Кастомный рендеринг сообщений
├── ui/
│   └── agent-widget.ts         # Виджет статуса субагентов (обновление 80мс)
├── memory/
│   ├── database.ts             # SQLite + FTS5 база данных
│   ├── session-memory.ts       # Извлечение фактов из сессий
│   └── result-compressor.ts    # Сжатие больших результатов
└── context-tools/
    ├── ctx-bash.ts             # bash с сохранением контекста
    ├── ctx-read.ts             # read с сохранением контекста
    ├── ctx-search.ts           # ctx_search (FTS5)
    ├── ctx-stats.ts            # Статистика БД
    └── utils/                  # Утилиты (analyzers, logger, summary)
```

---

## 🔄 Жизненный цикл субагента

### 1. Запуск (`/agent-bg`)

```
Пользователь
    │
    ▼
/agent-bg [--no-inject] <prompt>
    │
    ▼
AgentManager.spawn()
    │
    ├── 1. Создаёт AgentRecord (id, type, status="queued")
    │
    ├── 2. Добавляет в очередь (или запускает сразу если < maxConcurrent)
    │
    ├── 3. AgentManager.runAgent()
    │       │
    │       ├── 3a. AgentRunner.runAgent()
    │       │       │
    │       │       ├── 3a-i. Создаёт новую сессию (createAgentSession)
    │       │       │   - Уникальный sessionId
    │       │       │   - Копирует настройки из AgentConfig
    │       │       │   - Загружает extensions/skills/prompts
    │       │       │
    │       │       ├── 3a-ii. Собирает системный промпт (prompts.ts)
    │       │       │   - "append" режим: parent prompt + sub_agent_context + custom prompt
    │       │       │   - "replace" режим: только custom prompt
    │       │       │   - Инжекция memoryBlock (факты из session memory)
    │       │       │   - Инжекция preloaded skills
    │       │       │
    │       │       ├── 3a-iii. Запускает agent loop
    │       │       │   - LLM вызывает инструменты
    │       │       │   - AgentRunner перехватывает SUBAGENT_TOOL_NAMES
    │       │       │     (get_subagent_result, steer_subagent)
    │       │       │
    │       │       └── 3a-iv. Собирает результат
    │       │           - toolUses, duration, usage
    │       │           - Сжатие результата (result-compressor.ts)
    │       │
    │       └── 3b. Обновляет AgentRecord (status="completed", result)
    │
    └── 4. AgentWidget.update() — обновление UI
        │
        └── 5. onComplete callback — уведомление пользователя
```

### 2. Управление (`/agent-steer`, `/agent-inject`)

```
Пользователь
    │
    ▼
/agent-steer <text>
    │
    ▼
AgentManager.steerAgent(id, text)
    │
    ├── 1. Находит AgentRecord по id
    │
    ├── 2. Добавляет pendingSteers
    │
    └── 3. AgentRunner получает steer через tool_call (steer_subagent)
        │
        └── LLM видит steer и адаптирует поведение
```

### 3. Получение результата (`/agent-result`)

```
Пользователь
    │
    ▼
/agent-result <id>
    │
    ▼
AgentManager.getRecord(id)
    │
    ├── status="completed" → показывает result
    ├── status="running"  → показывает прогресс
    └── status="queued"   → показывает что в очереди
```

### 4. Мониторинг (`/agent-view`)

```
Пользователь
    │
    ▼
/agent-view <id>
    │
    ▼
Режим мониторинга
    │
    ├── setInterval(1000ms) — чтение activity.responseText
    │   - Выводит новые части текста в notify
    │
    ├── setInterval(500ms) — проверка статуса
    │   - Если status != "running" → завершает мониторинг
    │
    └── setTimeout(300000ms) — таймаут 5 минут
```

---

## 🧠 Система памяти (Memory)

### SQLite База данных (`.pi/memory/unified.db`)

```
┌─────────────────────────────────────────────────────┐
│              Memory Database (SQLite)                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────────┐            │
│  │ tool_outputs │  │ subagent_results │            │
│  │ ────────────  │  │ ───────────────  │            │
│  │ id            │  │ id               │            │
│  │ tool_name     │  │ agent_type       │            │
│  │ args          │  │ description      │            │
│  │ output        │  │ result           │            │
│  │ summary       │  │ timestamp        │            │
│  │ timestamp     │  │ status           │            │
│  │ size          │  │ tool_uses        │            │
│  └──────────────┘  │ duration_ms      │            │
│                     └──────────────────┘            │
│                                                     │
│  ┌──────────────┐  ┌──────────────────┐            │
│  │session_facts │  │compressed_results│            │
│  │ ────────────  │  │ ───────────────  │            │
│  │ id            │  │ original_hash    │            │
│  │ session_id    │  │ compressed       │            │
│  │ fact_type     │  │ timestamp        │            │
│  │   (decision   │  └──────────────────┘            │
│  │    lesson     │                                  │
│  │    preference │  ┌──────────────────┐            │
│  │    architecture)│ │  FTS5 Index      │            │
│  │    api)        │  │ ───────────────  │            │
│  │ content        │  │ По всем текстовым│            │
│  │ timestamp      │  │ полям всех таблиц│            │
│  └──────────────┘  └──────────────────┘            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Фаза 4A: Извлечение фактов (session-memory.ts)

```
session_before_compact
    │
    ▼
SessionMemory.extractAndSaveFacts(messages)
    │
    ├── 1. Проходит по сообщениям сессии
    │
    ├── 2. Применяет FACT_PATTERNS (regex)
    │   ├── decision: "решение", "выбрали", "decided to"
    │   ├── lesson: "важно", "запомни", "mistake"
    │   ├── preference: "предпочитаю", "хочу"
    │   ├── architecture: "архитектура", "структура"
    │   └── api: "endpoint", "route", "auth"
    │
    ├── 3. Фильтрует по длине (20-500 символов)
    │
    ├── 4. Проверяет дубликаты (hash)
    │
    └── 5. Сохраняет в session_facts
        │
        └── Используется при запуске субагентов (инжекция в промпт)
```

### Фаза 4B: Инжекция фактов в промпт

```
before_agent_start
    │
    ▼
SessionMemory.getRelevantFacts(messages)
    │
    ├── 1. Считывает session_facts из БД
    │
    ├── 2. Выбирает релевантные (по типу сессии)
    │
    └── 3. Вставляет в system prompt как memoryBlock
        │
        └── Субагент получает контекст из предыдущих сессий
```

### Фаза 2C: Переопределение инструментов

```
registerTools()
    │
    ├── bash → executeCtxBash()
    │   ├── Exec command (child_process.exec)
    │   ├── Если output > 5000 символов → saveToolOutput() в БД
    │   └── Возвращает preview + "💾 Полный вывод сохранён (ID: X)"
    │
    ├── read → executeCtxRead()
    │   ├── Аналогично: large output → save в БД
    │   └── offset/limit для чтения чанков
    │
    ├── grep → executeCtxBash() с ripgrep
    │   ├── pattern, path, glob, ignoreCase, context, limit
    │   └── Large output → save в БД
    │
    ├── find → executeCtxBash() с find
    │   ├── pattern, path, limit
    │   └── Large output → save в БД
    │
    ├── ls → executeCtxBash()
    │   ├── path, options
    │   └── Large output → save в БД
    │
    └── ctx_search → executeCtxSearch()
        ├── FTS5 query по tool_outputs
        ├── "id:<n>" → полный вывод по ID
        └── limit по умолчанию
```

### Фаза 3: Сжатие результатов (result-compressor.ts)

```
compressResult(result, description)
    │
    ├── 1. Если < 2000 символов → пропуск
    │
    ├── 2. Проверка кэша (SHA256 hash)
    │   ├── Если найден → возвращает cached
    │   └── Иначе → вычисляет hash
    │
    ├── 3. LLM-сжатие
    │   ├── Отправляет результат LLM
    │   ├── Сжимает до ≤ 1000 символов
    │   └── Сохраняет в compressed_results
    │
    └── 4. Fallback: эвристическое сжатие
        ├── Убирает дубликаты
        ├── Сокращает пробелы
        └── Сохраняет ключевые части
```

---

## 🎛 Управление агентами (AgentManager)

```
AgentManager
    │
    ├── agents: Map<id, AgentRecord>     # Все агенты
    ├── queue: { id, args }[]             # Очередь агентов
    ├── runningBackground: number         # Кол-во запущенных
    ├── maxConcurrent: number (default: 4)
    ├── cleanupInterval: setInterval(60s) # Очистка завершённых
    │
    ├── spawn(args)
    │   ├── Если running < maxConcurrent → запускает сразу
    │   └── Иначе → добавляет в queue
    │
    ├── drainQueue()
    │   ├── Проверяет queue
    │   └── Запускает агентов если есть место
    │
    ├── getRecord(id)
    │   ├── Возвращает AgentRecord
    │   └── status: queued | running | completed | steered | aborted | error
    │
    ├── steerAgent(id, text)
    │   ├── Добавляет pendingSteers
    │   └── Агент получит steer на следующем tool_call
    │
    ├── abortAgent(id)
    │   ├── abortController.abort()
    │   └── status = "aborted"
    │
    ├── abortAll()
    │   └── Abort всех running агентов
    │
    ├── dispose()
    │   └── clearInterval(cleanupInterval)
    │
    └── cleanup()
        ├── Удаляет completed агентов из map
        └── Запускает queue
```

---

## 📊 UI Виджет (agent-widget.ts)

```
AgentWidget
    │
    ├── widgetInterval: setInterval(80ms)  # Обновление виджета
    ├── finishedTurnAge: Map<agentId, turns>
    ├── ERROR_LINGER_TURNS = 2             # Ошибочные linger 2 хода
    │
    ├── update()
    │   ├── Фильтрует finished агентов
    │   │   ├── completed → показ 1 ход
    │   │   └── error/aborted → показ 2 хода
    │   │
    │   ├── Рендерит статус каждого агента
    │   │   ├── running → "thinking…"
    │   │   ├── completed → "✓ completed"
    │   │   ├── error → "✗ error"
    │   │   └── steered → "↻ steered"
    │   │
    │   └── Обновляет status bar в TUI
    │
    ├── onTurnStart()
    │   ├── Инкрементирует finishedTurnAge
    │   └── Запускает update()
    │
    └── markFinished(agentId)
        ├── Добавляет в finishedTurnAge
        └── Запускает update()
```

---

## 🔄 Система событий (pi.on)

### loop-police (обнаружение зацикливания)

| Событие | Действие |
|---------|----------|
| `agent_start` | Сброс AgentState, новый sessionId |
| `turn_start` | Сброс счётчиков цикла |
| `message_update` | Мониторинг thinking-блока (character loops) |
| `message_end` | Анализ semantic loops, tool loops |
| `tool_call` | Отслеживание repeated tool calls |

### pi-sub (управление субагентами)

| Событие | Действие |
|---------|----------|
| `session_start` | Инициализация UI, clear completed agents, set session ID |
| `session_before_switch` | clear completed agents |
| `session_shutdown` | abortAll(), dispose() |
| `tool_execution_start` | Обновление UI виджета |
| `tool_result` | **Обрезка вывода до 50KB** |
| `session_before_compact` | **Извлечение фактов из сообщений** |
| `before_agent_start` | **Внедрение кастомного системного промпта** |

### web-search-guidance (обучение модели)

| Событие | Действие |
|---------|----------|
| `agent_start` | Сброс предупреждений |
| `tool_call` | Валидация web_search (numResults ≤ 2) |
| `tool_call` | Валидация fetch_content (maxLength ≤ 1000, offset) |
| `tool_result` | Обновление состояния для детекции необходимости offset |

---

## 🧩 Типы агентов (agent-types.ts)

```
Встроенные агенты (default-agents.ts):
├── coding:        # Кодирование (write, edit, bash)
├── readonly:      # Только чтение (read, grep, find, ls)
├── memory:        # Работа с памятью (read, write, edit)
└── research:      # Исследование (bash, grep, find)

Пользовательские агенты (.pi/agents/*.md):
└── Загружаются из markdown файлов
    - name, description, systemPrompt
    - model, thinking, maxTurns
    - tools (builtinToolNames, disallowedTools)
    - extensions, skills
    - isolation (worktree)
```

---

## 🌊 Flow: Запуск субагента

```
1. Пользователь: /agent-bg coding "Рефактори auth"
    │
2. AgentManager.spawn()
    │
3. AgentRunner.runAgent()
    │
4. createAgentSession()
    ├── Создаёт новую сессию
    ├── Загружает extensions (по config)
    ├── Загружает skills (по config)
    └── Загружает prompts (по config)
    │
5. buildAgentPrompt()
    ├── Если append: parent prompt + sub_agent_context + custom
    ├── Если replace: только custom prompt
    ├── Инжекция memoryBlock (из session memory)
    ├── Инжекция preloaded skills
    └── <active_agent name="coding"/> тег
    │
6. Agent loop
    ├── LLM вызывает инструменты
    ├── SUBAGENT_TOOL_NAMES перехватываются
    │   ├── get_subagent_result → возвращает результат
    │   └── steer_subagent → pendingSteers
    │
7. Результат
    ├── Сжатие (если > 2000 символов)
    ├── Сохранение в subagent_results
    └── Обновление AgentRecord
    │
8. UI
    ├── AgentWidget.update()
    └── notify("Agent completed")
```

---

## 📦 Зависимости

| Пакет | Назначение |
|-------|-----------|
| `better-sqlite3` | SQLite база данных |
| `@earendil-works/pi-coding-agent` | API расширения |
| `@earendil-works/pi-tui` | TUI компоненты |
| `@sinclair/typebox` | Схемы параметров |

---

## 🎯 Ключевые оптимизации

1. **Экономия токенов**: Убраны descriptions из параметров инструментов
2. **KV Cache**: Shared parent prompt в append режиме
3. **Контекст**: Large outputs сохраняются в БД, показывается превью
4. **Память**: Автоматическое извлечение фактов перед compaction
5. **Сжатие**: LLM-сжатие больших результатов с кэшем
6. **Конкурентность**: Максимум 4 одновременных субагента
7. **loop-police**: Защита от зацикливания агентов

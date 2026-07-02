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

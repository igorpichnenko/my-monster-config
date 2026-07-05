# my-monster-config

> Коллекция расширений для pi-coding-agent: система субагентов с долгосрочной памятью, защита от зацикливания и веб-инструменты.

**Репозиторий:** https://github.com/igorpichnenko/my-monster-config

---

## 📦 Что входит в конфиг

| Расширение | Назначение | Статус |
|------------|------------|--------|
| **pi-sub** | Система субагентов с долгосрочной памятью, контекстным сохранением и оптимизацией | ✅ Активно |
| **loop-police** | Защита от зацикливания агентов (character/semantic/tool loops) | ✅ Активно |
| **pi-minimal-web** | Веб-инструменты (web_search, fetch_content) через Exa API | ✅ Активно |
| **web-search-guidance** | Автообучение модели правильному использованию веб-инструментов | ✅ Активно |
| **add_context** | Ручная отправка контекста модели | ✅ Активно |

---

## 🎯 Что даёт my-monster-config

| Проблема | Решение | Результат |
|----------|---------|-----------|
| **Переполнение контекста** | Большие выводы (>5000 символов) сохраняются в БД (pi-sub) | ✅ Контекст остаётся компактным |
| **Потеря информации** | Все выводы индексируются в SQLite + FTS5 (pi-sub) | ✅ Поиск через `ctx_search` |
| **Долгие задачи** | Субагенты выполняются в фоне (pi-sub) | ✅ Параллельная работа |
| **Забывание между сессиями** | Автоматическое извлечение фактов (pi-sub) | ✅ Модель помнит контекст |
| **Зацикливание агентов** | Loop-police детектит повторы (loop-police) | ✅ Экономия токенов |
| **Огромный system prompt** | Кастомный промпт (~300 токенов) (pi-sub) | ✅ Быстрый первый ответ |
| **Потеря данных субагентов** | Compact сохраняется для всех агентов (pi-sub) | ✅ Полная история работы |
| **Дубликаты в БД** | Deduplication через SHA-256 хэш (pi-sub) | ✅ Экономия места в БД |
| **Низкое качество поиска** | Priority System (1-10) (pi-sub) | ✅ Важные результаты выше |
| **Повторение ошибок** | Failure Memory (pi-sub) | ✅ Модель учится на ошибках |
| **Утечка секретов** | Secret Scanning (pi-sub) | ✅ Автоматическая маскировка |
| **Пропуск важных фактов** | Background Learning каждые 10 ходов (pi-sub) | ✅ Проактивное сохранение |
| **Игнорирование исправлений** | Correction Detection (pi-sub) | ✅ Модель запоминает правки |
| **Рост БД** | Automatic Purge раз в неделю (pi-sub) | ✅ Контроль размера БД |
| **Повреждение WAL** | memoryDb.close() в session_shutdown (pi-sub) | ✅ Безопасное закрытие БД |
| **Нет доступа к интернету** | web_search через Exa API (pi-minimal-web) | ✅ Модель ищет в интернете |
| **Неправильное использование web** | Автообучение модели (web-search-guidance) | ✅ Меньше ошибок |

---

## 🚀 Установка

```bash
# 1. Клонировать репозиторий
cd ~/.pi/agent/npm
git clone https://github.com/igorpichnenko/my-monster-config.git
cd my-monoster-config

# 2. Установить зависимости
npm install

# 3. Перезапустить pi
/reload
```

### Структура проекта

```
my-monster-config/
├── README.md
├── package.json
├── tsconfig.json
│
├── pi-sub/                          # Система субагентов с памятью
│   ├── index.ts                     # Точка входа, инициализация
│   ├── agent-manager.ts             # Управление жизненным циклом
│   ├── agent-runner.ts              # Ядро выполнения
│   ├── agent-types.ts               # Реестр типов агентов
│   ├── custom-agents.ts             # Загрузка из .pi/agents/
│   ├── default-agents.ts            # Встроенные агенты
│   ├── prompts.ts                   # Сборка системных промптов
│   ├── commands/
│   │   ├── agent-commands.ts        # /agent-* команды
│   │   ├── memory-commands.ts       # /memory-* команды
│   │   └── agents-menu.ts           # /agents
│   ├── tools/
│   │   └── register-tools.ts        # Переопределение инструментов
│   ├── memory/
│   │   ├── database.ts              # Фасад БД
│   │   ├── schema.ts                # Схема БД и миграции
│   │   ├── session-memory.ts        # Извлечение фактов
│   │   ├── result-compressor.ts     # Сжатие результатов
│   │   ├── consolidation.ts         # Auto-Consolidation
│   │   ├── repositories/            # Репозитории для каждой таблицы
│   │   │   ├── tool-outputs.repository.ts
│   │   │   ├── subagent-results.repository.ts
│   │   │   ├── session-facts.repository.ts
│   │   │   ├── compaction.repository.ts
│   │   │   ├── failures.repository.ts
│   │   │   └── compressed-results.repository.ts
│   │   └── utils/
│   │       ├── hash.ts              # Вычисление SHA-256
│   │       └── priority.ts          # Вычисление приоритета
│   ├── context-tools/
│   │   ├── ctx-bash.ts              # bash с сохранением
│   │   ├── ctx-read.ts              # read с сохранением
│   │   ├── ctx-search.ts            # ctx_search (FTS5)
│   │   └── utils/
│   │       ├── analyzers.ts         # Анализаторы вывода
│   │       ├── summary.ts           # Генерация summary
│   │       ├── compaction-summary.ts
│   │       ├── failure-detector.ts  # Детектор неудач
│   │       └── secret-scanner.ts    # Сканирование секретов
│   ├── ui/
│   │   └── agent-widget.ts          # Виджет статуса
│   └── renderers/
│       └── message-renderers.ts
│
├── loop-police/                     # Защита от зацикливания
│   ├── index.ts                     # Точка входа
│   ├── loop-detector.ts             # Детектор зацикливания
│   ├── semantic-analyzer.ts         # Семантический анализ
│   └── commands/
│       └── loop-police-commands.ts  # /loop-police команда
│
├── pi-minimal-web/                  # Веб-инструменты
│   ├── index.ts                     # Точка входа
│   ├── exa.ts                       # Exa API клиент
│   ├── extract.ts                   # Извлечение контента
│   └── tools/
│       ├── web-search.ts            # web_search инструмент
│       └── fetch-content.ts         # fetch_content инструмент
│
└── extensions/                      # Дополнительные расширения
    ├── add_context.ts               # /add_context команда
    └── web-search-guidance.ts       # Автообучение модели
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
- **Deduplication**: если вывод уже сохранён — возвращает существующий ID (♻️)
- **Priority**: вычисляется автоматически (git → 🟠, ошибки → 🔴, ls → 🟢)

#### `read`

```typescript
read({ path: "src/index.ts", offset: 0, limit: 100 })
```

- Поддержка offset/limit для больших файлов
- Авто-сохранение в БД
- **Deduplication**: если файл уже сохранён — возвращает существующий ID (♻️)
- **Priority**: файлы с ошибками получают повышенный приоритет

#### `grep`

```typescript
grep({ pattern: "TODO", path: "src/", options: "-rn" })
```

- Автоматически исключает `.git`
- Использует `rg` если установлен
- **Priority**: поиск с ошибками → 🔴, без ошибок → 🟢

#### `find`

```typescript
find({ pattern: "*.ts", path: ".", limit: 1000 })
```

- Автоматически исключает `.git`
- Использует `fdfind` если установлен
- **Priority**: поиск с ошибками → 🔴, без ошибок → 🟢

#### `ls`

```typescript
ls({ path: ".", options: "-la" })
```

- **Priority**: обычно 🟢 (низкий приоритет)

#### `ctx_search` (pi-sub)

```typescript
ctx_search({ query: "registerCommand", limit: 10 })
ctx_search({ query: "id:42" })           // числовой ID
ctx_search({ query: "id:28622e05-cd3b-492" })  // UUID субагента
```

- Полнотекстовый поиск (FTS5) по всем сохранённым выводам
- Поиск по tool_name, args, output, summary
- Специальный запрос `id:<n>` для получения полного вывода
- **Поддержка UUID**: работает с укороченными UUID субагентов
- Группировка keywords по компакциям
- **Priority-based sorting**: результаты tool_outputs сортируются по приоритету
- **Priority emoji**: 🔴 критический, 🟠 высокий, 🟡 средний, 🟢 низкий

### Веб-инструменты (pi-minimal-web)

#### `web_search`

```typescript
web_search({ query: "pi coding agent", numResults: 3 })
```

- Поиск в интернете через Exa API
- `numResults`: количество результатов (по умолчанию 1, макс 5)
- `offset`: смещение для пагинации
- **Валидация**: web-search-guidance ограничивает numResults ≤ 2

#### `fetch_content`

```typescript
fetch_content({ url: "https://example.com", maxLength: 2000 })
```

- Получение содержимого URL как markdown
- `maxLength`: максимальная длина (по умолчанию 1000, макс 10000)
- `offset`: смещение для пагинации
- **Валидация**: web-search-guidance проверяет maxLength и offset

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
| `/memory-stats` | Статистика БД (включая priority stats) | - |
| `/memory-search` | Поиск по всем данным | `<query>` |
| `/memory-add` | Добавить факт вручную | `<type> <content>` |
| `/memory-purge` | Очистить старые данные | `[tools=N] [facts=N]` |
| `/memory-test` | Тестовые операции с БД | - |
| `/memory-summaries` | Показать summaries компакции | `[limit]` |
| `/memory-keywords` | Показать ключевые слова компакций | `[query]` |
| `/memory-failures` | Показать память о неудачах | `[query]` |
| `/memory-subagents` | Показать все результаты субагентов | `[query]` или `[limit=N]` |
| `/memory-consolidate` | Консолидация похожих записей | `[--dry-run] [threshold=0.7]` |

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
/memory-failures ENOENT           # Поиск по неудачам
/memory-subagents                 # Показать все результаты субагентов
/memory-subagents subagent        # Поиск по ключевому слову
/memory-subagents limit=50        # Показать больше результатов
/memory-consolidate --dry-run     # Тест консолидации
/memory-consolidate threshold=0.8 # Консолидация с порогом 0.8
```

### Управление loop-police

| Команда | Описание | Параметры |
|---------|----------|-----------|
| `/loop-police` | Показать статус детекции зацикливания | - |
| `/loop-police reset` | Сбросить все состояния | `all` или `<sessionId>` |
| `/loop-police set` | Установить параметры | `KEY=VAL [KEY=VAL ...]` |

**Доступные параметры:**

```bash
/loop-police set REPEATED_TOOL_CALL_LIMIT=5
/loop-police set SEMANTIC_LOOP_THRESHOLD=0.7
/loop-police set STAGNATION_TURNS=5
/loop-police set FILE_READ_LIMIT=5
/loop-police set FILE_READ_WINDOW=600
```

**Примеры:**

```bash
/loop-police                    # Статус
/loop-police reset all          # Сброс всех состояний
/loop-police set REPEATED_TOOL_CALL_LIMIT=5
```

### Другие команды

| Команда | Источник | Описание |
|---------|----------|----------|
| `/agents` | pi-sub | Меню выбора типа агента |
| `/add_context` | extensions | Отправить контекст модели |

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
| `session_start` | Инициализация UI, set session ID, auto-consolidation если > 1000 записей, **automatic purge** если > 50 MB |
| `session_before_switch` | Очистка завершённых агентов |
| `session_shutdown` | Abort всех, dispose, **закрытие БД** (memoryDb.close()) |
| `tool_execution_start` | Обновление UI виджета |
| `tool_result` | Обрезка вывода до 5KB |
| `turn_end` | **Background Learning**: каждые 10 ходов извлекает факты |
| `message_update` | **Correction Detection**: детекция исправлений пользователя |
| `session_before_compact` | Извлечение фактов + неудач (только для main agent) |
| `before_agent_start` | Кастомный system prompt с memory policy |

**Примечание:** Генерация `detailed_summary` и `meta` происходит в `agent-runner.ts` при событии `compaction_end` для **всех агентов** (main + subagents).

### loop-police

| Событие | Действие |
|---------|----------|
| `agent_start` | Сброс AgentState, новый sessionId |
| `turn_start` | Сброс счётчиков цикла |
| `message_update` | Мониторинг thinking-блока (character loops) |
| `message_end` | Анализ semantic loops, tool loops |
| `tool_call` | Отслеживание repeated tool calls |

**Детекция зацикливания:**

- **Character-level loops** — повторяющиеся символы в thinking (порог: 80 символов)
- **Semantic loops** — повторяющиеся мысли (similarity > 0.7)
- **Tool loops** — одинаковые вызовы инструментов подряд (порог: 3)
- **Stagnation** — отсутствие прогресса за 5 ходов (similarity > 0.85)
- **File read limits** — лимит 5 чтений файлов за 600 секунд

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

| Процесс | Период | Расширение | Действие |
|---------|--------|------------|----------|
| AgentManager cleanup | 60 сек | pi-sub | Очистка завершённых агентов |
| AgentWidget update | 80 мс | pi-sub | Обновление виджета статуса |
| Agent status polling | 1 сек / 500 мс | pi-sub | Мониторинг вывода / статуса |
| Web search retry | 1 сек | pi-minimal-web | Exponential backoff при rate limiting |
| Content fetch timeout | Настраиваемый | pi-minimal-web | Отмена запроса через AbortController |

---

## 🧠 Система памяти (pi-sub)

### Архитектура БД

```
.pi/memory/unified.db (SQLite + WAL mode)
│
├── tool_outputs
│   ├── id, tool_name, args, output, summary, timestamp, size
│   ├── content_hash (SHA-256 для deduplication)
│   ├── priority (1-10 для сортировки)
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
├── compaction_keywords (нормализованные ключевые слова)
│   ├── id, compaction_id, keyword, category, timestamp
│   ├── category: file | decision | lesson
│   └── FTS5 index (compaction_keywords_fts)
│
└── failures (память о неудачах)
    ├── id, session_id, approach, error, reason, solution, context, timestamp
    └── FTS5 index (failures_fts)
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

// Поиск по числовому ID (полный вывод)
ctx_search({ query: "id:42" })

// Поиск по UUID субагента (полный результат)
ctx_search({ query: "id:28622e05-cd3b-492" })

// Поиск по ключевым словам компакций
ctx_search({ query: "WAL mode" })

// Поиск по неудачам
ctx_search({ query: "ENOENT" })
```

**Что ищет:** По **ВСЕМ** таблицам с FTS5:
- `tool_outputs` — прошлые выводы bash/read/grep/find/ls (с приоритетом)
- `subagent_results` — результаты прошлых субагентов
- `session_facts` — извлечённые факты
- `compaction_summaries` — summaries компакций (main + subagents)
- `compressed_results` — сжатые результаты
- `compaction_keywords` — нормализованные ключевые слова (main + subagents)
- `failures` — память о неудачах

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

### Deduplication (Phase 12)

**Принцип:** Перед сохранением `tool_output` вычисляется SHA-256 хэш от `output`. Если такой хэш уже есть — возвращается существующий ID и summary, не создаётся дубликат.

**Пример:**
```
Сессия 1: bash "ls -la" → output: "total 123..." → hash: abc123 → ID: 1
Сессия 2: bash "ls -la" → output: "total 123..." → hash: abc123 → возвращаем ID: 1 (дубликат!)
```

**Экономия:** При повторных вызовах одних и тех же команд (например, `git status`, `npm test`) БД не разрастается.

**Индикаторы:**
- 💾 — новый вывод сохранён
- ♻️ — вывод уже сохранён (дубликат)

### Priority System (Phase 12)

**Принцип:** Каждому `tool_output` присваивается приоритет (1-10). При поиске результаты сортируются по приоритету.

**Правила:**
```
Ошибки (error/failed)      → +3 (priority 8)
Git команды                → +2 (priority 7)
Тесты (jest/pytest)        → +2 (priority 7)
npm install/yarn add       → +2 (priority 7)
Docker                     → +1 (priority 6)
Сборка (build/compile)     → +1 (priority 6)
ls/cat/echo                → -1 (priority 4)
Обычные команды            → 0  (priority 5)
```

**Эмодзи приоритета:**
- 🔴 (8-10) — критический
- 🟠 (6-7) — высокий
- 🟡 (4-5) — средний
- 🟢 (1-3) — низкий

**Пример:**
```
ctx_search "database" →
  1. [priority 8] 🔴 ❌ Error: connection to database failed
  2. [priority 7] 🟠 🧪 jest: 47 passed, 3 failed
  3. [priority 5] 🟡 📄 file.ts: database connection code
```

### Failure Memory (Phase 11)

**Принцип:** Автоматическое извлечение информации о неудачах из сообщений перед компакцией.

**Паттерны детекции:**
```
"не сработало", "failed", "doesn't work", "error", "ошибка"
"попробовал", "tried", "attempted"
"откатил", "reverted", "rolled back", "undo"
"compilation error", "syntax error", "runtime error"
"unexpected", "неожиданно", "странно"
```

**Структура записи:**
```typescript
{
  approach: "Tried to use fs.readFileSync",
  error: "ENOENT: no such file or directory",
  reason: "File doesn't exist yet",
  solution: "Use fs.existsSync check first",
  context: "Additional context"
}
```

**Пример:**
```bash
/memory-failures              # Показать все неудачи
/memory-failures ENOENT       # Поиск по конкретной ошибке
```

### Background Learning (Phase 8)

**Принцип:** Каждые 10 ходов автоматически извлекаются факты из последних 20 сообщений.

**Зачем:** Если сессия короткая и compaction не сработает, факты всё равно сохранятся.

**Как работает:**
```typescript
pi.on("turn_end", async (event, ctx) => {
  turnCount++;
  if (turnCount % 10 === 0) {
    const recentMessages = getRecentMessages(20);
    sessionMemory.extractAndSaveFacts(recentMessages);
  }
});
```

### Correction Detection (Phase 9)

**Принцип:** Когда пользователь исправляет агента, это автоматически сохраняется как урок.

**Паттерны детекции:**
```
"нет, это не так", "no, that's wrong"
"исправь", "correct", "wrong", "неверно", "ошибка"
"stop that", "don't do that"
```

**Как работает:**
```typescript
pi.on("message_update", async (event, ctx) => {
  if (event.message.role === "user") {
    const text = extractText(event.message.content);
    if (CORRECTION_PATTERNS.some(p => p.test(text))) {
      memoryDb.saveFact({
        sessionId: sessionMemory.getSessionId(),
        factType: "lesson",
        content: `User correction: ${text.slice(0, 200)}`,
      });
    }
  }
});
```

### Secret Scanning (Phase 7)

**Принцип:** Автоматическая проверка всех сохраняемых данных на наличие секретов (API keys, tokens, passwords).

**Паттерны:**
```
OpenAI API keys:     sk-[a-zA-Z0-9]{32,}
GitHub tokens:       ghp_[a-zA-Z0-9]{36}
Bearer tokens:       Bearer\s+[a-zA-Z0-9\-._~+\/]+=*
JWT tokens:          eyJ[a-zA-Z0-9_-]*\.eyJ...
SSH private keys:    -----BEGIN RSA PRIVATE KEY-----
AWS keys:            AKIA[0-9A-Z]{16}
Passwords:           password\s*[:=]\s*["'][^"']+["']
```

**Как работает:**
```typescript
const scanResult = scanForSecrets(data.output);
if (scanResult.hasSecret) {
  console.warn(`🛡️ Secret detected, saving redacted version`);
  outputToSave = redactSecret(data.output); // заменяет на [REDACTED]
}
```

**Защита:**
- `saveToolOutput` — проверка вывода инструментов
- `saveSubagentResult` — проверка результатов субагентов
- `saveCompactionSummary` — проверка detailed_summary
- `saveFailure` — проверка записей о неудачах
- `saveCompressedResult` — проверка сжатых результатов

### Auto-Consolidation (Phase 10)

**Принцип:** Автоматическое слияние похожих записей в `session_facts` для уменьшения дубликатов.

**Алгоритм:**
1. Вычисляется Jaccard similarity между записями
2. Записи с similarity ≥ threshold (по умолчанию 0.7) группируются
3. Группа сливается в одну запись (берётся самая длинная + уникальная информация)
4. Дубликаты удаляются

**Когда запускается:**
- Автоматически при старте сессии, если `session_facts > 1000`
- Вручную через команду `/memory-consolidate`

**Пример:**
```bash
/memory-consolidate --dry-run     # Тест без изменений
/memory-consolidate threshold=0.8 # Консолидация с порогом 0.8
/memory-consolidate               # Запуск консолидации
```

### Automatic Purge (Phase 13)

**Принцип:** Автоматическая очистка старых данных из БД раз в неделю для контроля размера.

**Когда запускается:**
- Автоматически при старте сессии
- Только если прошло > 7 дней с последнего purge
- Только если БД > 50 MB ИЛИ tool_outputs > 5000

**Что очищается:**
- ✅ `tool_outputs` старше 7 дней (большие выводы инструментов)
- ✅ `compaction_summaries` старше 30 дней
- ✅ `compaction_keywords` старше 30 дней
- ✅ `compressed_results` старше 30 дней

**Что НЕ очищается:**
- ❌ `session_facts` — долгосрочная память (решения, уроки)
- ❌ `subagent_results` — история работы субагентов
- ❌ `failures` — память о неудачах

**Пример логов:**
```
[pi-sub] 🧹 DB size OK (30.5 MB, 2000 tools), skipping purge
[pi-sub] 🧹 Running automatic purge (DB: 60.5 MB, 6000 tool outputs)...
[pi-sub] 🧹 Purged: 5000 tools, 150 summaries, 300 keywords, 50 compressed.
         DB size: 60.5 MB → 25.3 MB
```

**Ручной запуск:**
```bash
/memory-purge tools=7 facts=30  # Очистить tool_outputs старше 7 дней
```

### Безопасное закрытие БД

**Принцип:** При завершении сессии БД корректно закрывается для предотвращения повреждения WAL-файла.

**Как работает:**
```typescript
pi.on("session_shutdown", async () => {
  manager.abortAll();
  manager.dispose();
  
  if (memoryDb) {
    memoryDb.close();
    console.log(`[pi-sub] 📦 Memory database closed`);
  }
});
```

**Зачем:**
- Предотвращает повреждение WAL-файла при аварийном завершении
- Освобождает файловые дескрипторы
- Гарантирует целостность данных

---

## 🚔 Loop-Police: Защита от зацикливания

### Что детектируется

#### 1. Character-level loops

Повторяющиеся символы в thinking-блоке модели:

```typescript
// Пример зацикливания:
"........."  // 80+ символов → детектируется
"aaaaaaaaa"  // 80+ символов → детектируется
```

**Порог:** 80 символов  
**Действие:** Обрезка thinking-блока

#### 2. Semantic loops

Повторяющиеся мысли/параграфы:

```typescript
// Модель повторяет одну и ту же мысль:
Turn 1: "Нужно проверить файл database.ts"
Turn 2: "Нужно проверить файл database.ts"
Turn 3: "Нужно проверить файл database.ts"
// similarity > 0.7 → детектируется
```

**Порог:** similarity > 0.7, 3+ повторений  
**Действие:** Блокировка повторяющихся tool calls

#### 3. Tool loops

Одинаковые вызовы инструментов подряд:

```typescript
// Модель вызывает один и тот же инструмент с теми же аргументами:
bash("ls -la")
bash("ls -la")
bash("ls -la")
// 3+ повторений → детектируется
```

**Порог:** 3 одинаковых вызова подряд  
**Действие:** Блокировка повторяющихся tool calls

#### 4. Stagnation

Отсутствие прогресса за несколько ходов:

```typescript
// Модель не делает прогресса:
Turn 1: read("file.ts") → similarity 0.9
Turn 2: read("file.ts") → similarity 0.9
Turn 3: read("file.ts") → similarity 0.9
Turn 4: read("file.ts") → similarity 0.9
Turn 5: read("file.ts") → similarity 0.9
// 5 ходов без прогресса → детектируется
```

**Порог:** 5 ходов, similarity > 0.85  
**Действие:** Recovery mode (3 хода с повышенными лимитами)

#### 5. File read limits

Слишком частое чтение файлов:

```typescript
// Модель читает файлы слишком часто:
read("file1.ts")
read("file2.ts")
read("file3.ts")
read("file4.ts")
read("file5.ts")
read("file6.ts")  // 6-е чтение за 600 секунд → детектируется
```

**Порог:** 5 чтений за 600 секунд  
**Действие:** Блокировка дальнейших чтений

### Настройка параметров

```bash
# Показать текущие параметры
/loop-police

# Сбросить все состояния
/loop-police reset all

# Сбросить состояние для конкретной сессии
/loop-police reset session-1234567890-abc123

# Установить параметры
/loop-police set REPEATED_TOOL_CALL_LIMIT=5
/loop-police set SEMANTIC_LOOP_THRESHOLD=0.7
/loop-police set STAGNATION_TURNS=5
/loop-police set FILE_READ_LIMIT=5
/loop-police set FILE_READ_WINDOW=600
```

### Доступные параметры

| Параметр | По умолчанию | Описание |
|----------|--------------|----------|
| `REPEATED_TOOL_CALL_LIMIT` | 3 | Порог для tool loops |
| `SEMANTIC_LOOP_THRESHOLD` | 0.7 | Порог similarity для semantic loops |
| `STAGNATION_TURNS` | 5 | Количество ходов для stagnation detection |
| `STAGNATION_THRESHOLD` | 0.85 | Порог similarity для stagnation |
| `FILE_READ_LIMIT` | 5 | Лимит чтений файлов |
| `FILE_READ_WINDOW` | 600 | Окно времени для file read limits (сек) |
| `CHAR_LOOP_THRESHOLD` | 80 | Порог для character-level loops |

---

## 🌐 Pi-Minimal-Web: Веб-инструменты

### web_search

Поиск в интернете через Exa API:

```typescript
web_search({ 
  query: "pi coding agent", 
  numResults: 3,
  offset: 0 
})
```

**Параметры:**
- `query` (обязательно): поисковый запрос
- `numResults` (опционально): количество результатов (по умолчанию 1, макс 5)
- `offset` (опционально): смещение для пагинации

**Особенности:**
- Использует Exa API для поиска
- Rate limiting с exponential backoff
- Возвращает результаты в формате markdown

**Валидация (web-search-guidance):**
- `numResults` ограничивается ≤ 2 (по умолчанию)
- После 3+ правильных вызовов проверки отключаются

### fetch_content

Получение содержимого URL как markdown:

```typescript
fetch_content({ 
  url: "https://example.com", 
  maxLength: 2000,
  offset: 0 
})
```

**Параметры:**
- `url` (обязательно): URL для загрузки
- `maxLength` (опционально): максимальная длина (по умолчанию 1000, макс 10000)
- `offset` (опционально): смещение для пагинации

**Особенности:**
- Извлекает контент и конвертирует в markdown
- Настраиваемый timeout через AbortController
- Поддержка пагинации через offset

**Валидация (web-search-guidance):**
- `maxLength` ограничивается ≤ 1000 без offset
- Блокировка при `offset > 0` если весь контент уже получен
- Блокировка при увеличении `maxLength` без offset

---

## 🎓 Web-Search-Guidance: Автообучение модели

### Принцип работы

Расширение автоматически обучает модель правильному использованию веб-инструментов через валидацию и обратную связь.

### Валидация web_search

```typescript
// ❌ Неправильно (numResults > 2)
web_search({ query: "test", numResults: 5 })
// → Блокировка + предупреждение

// ✅ Правильно (numResults ≤ 2)
web_search({ query: "test", numResults: 2 })
// → Успешный вызов
```

### Валидация fetch_content

```typescript
// ❌ Неправильно (maxLength > 1000 без offset)
fetch_content({ url: "https://example.com", maxLength: 5000 })
// → Блокировка + предупреждение

// ✅ Правильно (maxLength ≤ 1000)
fetch_content({ url: "https://example.com", maxLength: 1000 })
// → Успешный вызов

// ❌ Неправильно (offset > 0, но весь контент уже получен)
fetch_content({ url: "https://example.com", offset: 1000 })
// → Блокировка + предупреждение

// ✅ Правильно (offset используется корректно)
fetch_content({ url: "https://example.com", offset: 1000, maxLength: 1000 })
// → Успешный вызов
```

### Автообучение

Если модель **3+ раза подряд** правильно использует инструмент — проверки автоматически отключаются. Это позволяет модели работать быстрее после обучения.

```typescript
// Счётчик правильных вызовов
let correctCalls = 0;

pi.on("tool_result", (event, ctx) => {
  if (event.toolName === "web_search" && isValid(event.result)) {
    correctCalls++;
    if (correctCalls >= 3) {
      // Отключаем проверки
      disableValidation();
    }
  }
});
```

---

## 🤝 Как расширения работают вместе

### Взаимодействие pi-sub и loop-police

```
/agent-bg найди все TODO в проекте
    │
    ▼
pi-sub создаёт субагента
    │
    ▼
Субагент начинает работу
    │
    ├── loop-police мониторит на зацикливание
    │   ├── Если character loop → обрезка thinking
    │   ├── Если tool loop → блокировка повторных вызовов
    │   └── Если stagnation → recovery mode
    │
    ▼
Субагент завершает работу
    │
    ▼
pi-sub сохраняет результат в БД
```

### Взаимодействие pi-sub и pi-minimal-web

```
/agent-bg найди информацию о TypeScript в интернете
    │
    ▼
pi-sub создаёт субагента
    │
    ▼
Субагент вызывает web_search
    │
    ├── web-search-guidance валидирует параметры
    │   ├── Если numResults > 2 → блокировка
    │   └── Если правильно → успешный вызов
    │
    ▼
pi-minimal-web возвращает результаты
    │
    ▼
pi-sub сохраняет результат в БД
```

### Взаимодействие всех расширений

```
Пользователь: /agent-bg исследуй проект и найди информацию в интернете
    │
    ▼
pi-sub создаёт субагента
    │
    ├── loop-police мониторит на зацикливание
    ├── web-search-guidance обучает использованию web инструментов
    └── pi-minimal-web предоставляет веб-инструменты
    │
    ▼
Субагент работает:
    ├── read("package.json") → pi-sub сохраняет в БД
    ├── web_search("TypeScript") → web-search-guidance валидирует
    ├── fetch_content(url) → pi-minimal-web получает контент
    └── bash("npm test") → pi-sub сохраняет в БД
    │
    ▼
Субагент завершает работу
    │
    ▼
pi-sub сохраняет результат в БД
    │
    ▼
Модель может найти результат через ctx_search
```

---

## 🏗 Архитектура

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
    │   ├── loop-police мониторит на зацикливание
    │   ├── Инструменты сохраняют большие выводы в БД
    │   │   ├── Deduplication через content_hash
    │   │   ├── Priority System (1-10)
    │   │   └── Secret Scanning
    │   └── При compaction_end → генерирует detailed_summary + meta
    └── Собирает результат
    │
    ▼
onComplete callback
    ├── Сохраняет результат в subagent_results
    ├── Если !noInject → инжектирует в родителя
    └── Обновляет UI виджет
    │
    ▼
onCompact callback
    ├── Сохраняет summary + detailed_summary в compaction_summaries
    └── Сохраняет keywords в compaction_keywords
```

### Фоновые процессы

```
session_start
    │
    ├── Инициализация Session Memory
    ├── Auto-Consolidation (если session_facts > 1000)
    └── Automatic Purge (если > 50 MB ИЛИ > 5000 tools, раз в неделю)
    │
    ▼
turn_end (каждые 10 ходов)
    │
    └── Background Learning: извлечение фактов из последних 20 сообщений
    │
    ▼
message_update (user messages)
    │
    └── Correction Detection: детекция исправлений → сохранение как lesson
    │
    ▼
session_before_compact
    │
    ├── Извлечение фактов (только main agent)
    └── Извлечение неудач (Failure Memory)
    │
    ▼
compaction_end (все агенты)
    │
    ├── Генерация detailed_summary + meta
    ├── Сохранение в compaction_summaries
    └── Сохранение keywords в compaction_keywords
    │
    ▼
session_shutdown
    │
    └── Закрытие БД (memoryDb.close())
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
sqlite3 .pi/memory/unified.db "SELECT COUNT(*) FROM failures;"

# Последние записи с приоритетом
sqlite3 .pi/memory/unified.db "SELECT id, tool_name, priority, size FROM tool_outputs ORDER BY priority DESC, timestamp DESC LIMIT 10;"

# Статистика по приоритетам
sqlite3 .pi/memory/unified.db "SELECT priority, COUNT(*) as count FROM tool_outputs GROUP BY priority ORDER BY priority DESC;"

# Статистика ключевых слов
sqlite3 .pi/memory/unified.db "SELECT category, COUNT(*) FROM compaction_keywords GROUP BY category;"

# Компакции по агентам
sqlite3 .pi/memory/unified.db "SELECT id, reason, tokens_before, length(detailed_summary) as detailed_len FROM compaction_summaries ORDER BY timestamp DESC LIMIT 5;"

# Неудачи
sqlite3 .pi/memory/unified.db "SELECT id, approach, error FROM failures ORDER BY timestamp DESC LIMIT 5;"

# Дубликаты (по хэшу)
sqlite3 .pi/memory/unified.db "SELECT content_hash, COUNT(*) as count FROM tool_outputs WHERE content_hash IS NOT NULL GROUP BY content_hash HAVING count > 1;"

# Размер по таблицам
sqlite3 .pi/memory/unified.db "SELECT name, (page_count * page_size) / 1024.0 / 1024.0 as size_mb FROM pragma_page_count(), pragma_page_size();"
```

### Логи

```
[pi-sub] 📦 Memory database initialized. Tool outputs: 42, Subagent results: 5, Session facts: 12, Compaction keywords: 156, Failures: 3, Size: 12.5 MB
[pi-sub] 🧠 Session memory initialized (ID: session-1234567890-abc123)
[pi-sub] 🧹 DB size OK (30.5 MB, 2000 tools), skipping purge
[pi-sub] 🧹 Running automatic purge (DB: 60.5 MB, 6000 tool outputs)...
[pi-sub] 🧹 Purged: 5000 tools, 150 summaries, 300 keywords, 50 compressed. DB size: 60.5 MB → 25.3 MB
[pi-sub] 🔄 Auto-consolidation triggered (1234 facts)
[pi-sub] 🔄 Consolidation complete: 15 groups, 45 records merged, 30 records deleted
[pi-sub] 🎓 Background learning triggered (turn 10)
[pi-sub] 🎓 Background learning saved 3 facts
[pi-sub] ⚠️ Correction detected: нет, это не так, нужно использовать async/await
[pi-sub] ⚠️ Saved correction as lesson
[pi-sub] 🛡️ Secret detected in tool output (bash): OpenAI API key. Saving redacted version.
[pi-sub] 💾 Saved tool output (ID: 42, hash: abc123def456, priority: 7, size: 15234 chars)
[pi-sub] 🔄 Duplicate tool output detected (hash: abc123def456). Reusing ID: 42, priority: 7
[pi-sub] ⚠️ Found 2 failures in session
[pi-sub] ⚠️ Saved 2 failures to memory
[pi-sub] 📦 Generated compaction summary for agent abc123: 47 msgs, 5234 chars, 8 files, 3 decisions, 2 lessons
[pi-sub] 💾 Saved compaction summary (ID: 42, agent: research, 18432 tokens, 1234 chars summary, 5234 chars detailed)
[pi-sub] 🔑 Saved 13 keywords for compaction 42 (8 files, 3 decisions, 2 lessons)
[pi-sub] 🔇 Agent abc123: no-inject mode — showing result in UI only
[pi-sub] ✂️ Truncated large tool output to prevent context overflow
[pi-sub] 📦 Memory database closed
[loop-police] ⚠️ Character loop detected in thinking (85 chars)
[loop-police] ⚠️ Semantic loop detected (similarity: 0.82)
[loop-police] ⚠️ Tool loop detected: bash called 3 times with same args
[loop-police] ⚠️ Stagnation detected: no progress for 5 turns
[loop-police] ⚠️ File read limit exceeded: 6 reads in 600 seconds
[pi-minimal-web] 🔍 Searching: "pi coding agent"
[pi-minimal-web] ✅ Found 3 results
[pi-minimal-web] 🌐 Fetching: https://example.com
[pi-minimal-web] ✅ Fetched 1500 chars
[web-search-guidance] ⚠️ web_search blocked: numResults=5 > 2
[web-search-guidance] ⚠️ fetch_content blocked: maxLength=5000 > 1000
[web-search-guidance] ✅ Model learned: 3 correct calls in a row, disabling validation
```

### Тестирование инструментов

```bash
# Большой вывод (должен сохраниться в БД)
bash "seq 1 10000"

# Повторный вызов (должен показать ♻️ дубликат)
bash "seq 1 10000"

# Поиск по сохранённым
ctx_search "seq"

# Получить полный вывод
ctx_search "id:1"

# Поиск по UUID субагента
ctx_search "id:28622e05-cd3b-492"

# Поиск по ключевым словам
/memory-keywords WAL

# Поиск по неудачам
/memory-failures ENOENT

# Показать все результаты субагентов
/memory-subagents

# Поиск по результатам субагентов
/memory-subagents subagent

# Тест консолидации
/memory-consolidate --dry-run

# Ручной purge
/memory-purge tools=7 facts=30

# Тест всех операций
/memory-test

# Статус loop-police
/loop-police

# Сброс loop-police
/loop-police reset all

# Веб-поиск
web_search "pi coding agent"

# Получение контента
fetch_content "https://example.com"
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

### Добавление нового репозитория

```typescript
// memory/repositories/my-table.repository.ts
import type Database from "better-sqlite3";

export interface MyRecord {
  id: number;
  data: string;
  timestamp: number;
}

export class MyTableRepository {
  constructor(private db: Database.Database) {}

  save(data: { data: string }): number {
    const stmt = this.db.prepare(`
      INSERT INTO my_table (data, timestamp)
      VALUES (?, ?)
    `);
    const result = stmt.run(data.data, Date.now());
    return Number(result.lastInsertRowid);
  }

  getById(id: number): MyRecord | undefined {
    return this.db.prepare(
      "SELECT * FROM my_table WHERE id = ?"
    ).get(id) as MyRecord | undefined;
  }
}
```

---

## 📦 Зависимости

| Пакет | Версия | Назначение | Расширение |
|-------|--------|------------|------------|
| `better-sqlite3` | ^11.8.2 | SQLite база данных | pi-sub |
| `@earendil-works/pi-coding-agent` | >=0.74.0 | API расширения (peer) | Все |
| `@earendil-works/pi-tui` | * | TUI компоненты (peer) | pi-sub |
| `@sinclair/typebox` | ^0.34.33 | Схемы параметров | pi-sub |
| `nanoid` | ^5.1.5 | Генерация ID | pi-sub |
| `exa-js` | ^1.0.0 | Exa API клиент | pi-minimal-web |

---

## 📊 Статистика

| Категория | Количество |
|-----------|------------|
| Расширения | 5 |
| Переопределённые инструменты | 5 (bash, read, grep, find, ls) |
| Новые инструменты | 3 (ctx_search, web_search, fetch_content) |
| Команды pi-sub | 17 |
| Команды loop-police | 1 |
| Команды extensions | 1 |
| События pi-sub | 9 |
| События loop-police | 5 |
| События web-search-guidance | 4 |
| Фоновые процессы | 5 |
| Таблицы БД | 7 |
| FTS5 индексов | 7 |
| Репозиториев | 6 |

---

## 📖 Источники

- **Репозиторий**: https://github.com/igorpichnenko/my-monster-config
- **Исходный код**: `~/.pi/agent/npm/my-monster-config/`
- **Документация pi**: `~/.nvm/versions/node/v22.23.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
- **Примеры**: `~/.nvm/versions/node/v22.23.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/`
- **Exa API**: https://docs.exa.ai/

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
13. **Deduplication**: Экономия места в БД через SHA-256 хэши
14. **Priority System**: Важные результаты (ошибки, тесты, git) показываются выше
15. **Failure Memory**: Модель учится на прошлых ошибках
16. **Secret Scanning**: Защита от утечек API keys, tokens, passwords
17. **Background Learning**: Проактивное сохранение фактов каждые 10 ходов
18. **Correction Detection**: Автоматическое сохранение исправлений пользователя
19. **Auto-Consolidation**: Слияние похожих записей для уменьшения дубликатов
20. **Automatic Purge**: Контроль размера БД (раз в неделю, выборочная очистка)
21. **Безопасное закрытие БД**: memoryDb.close() в session_shutdown
22. **Модульная архитектура**: database.ts разделён на репозитории и утилиты
23. **Поддержка UUID**: ctx_search работает с укороченными UUID субагентов
24. **Веб-инструменты**: Интеграция с Exa API для поиска в интернете
25. **Автообучение**: web-search-guidance обучает модель правильному использованию web инструментов
26. **Rate limiting**: Exponential backoff при превышении лимитов API
27. **Валидация параметров**: Автоматическая проверка параметров web инструментов
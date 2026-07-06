/**
 * fts-escape.ts — Утилита для экранирования запросов FTS5.
 * 
 * v13: Вынесена из ctx-search.ts и subagent-results.repository.ts
 *      для устранения дублирования кода (DRY).
 * 
 * Используется везде, где нужен FTS5 MATCH запрос:
 * - ctx-search.ts — поиск по всем таблицам
 * - subagent-results.repository.ts — поиск по subagent_results
 * - session-facts.repository.ts — поиск по session_facts
 * - compaction.repository.ts — поиск по compaction_summaries/keywords
 * - failures.repository.ts — поиск по failures
 * - compressed-results.repository.ts — поиск по compressed_results
 */

/**
 * Экранирует запрос для FTS5 MATCH.
 * 
 * Спецсимволы FTS5: + - * ~ ( ) | & { } ^ "
 * 
 * Проблемы, которые решает:
 * 1. Дефис в словах (general-purpose) — FTS5 интерпретирует как NOT
 * 2. Кавычки — ломают синтаксис MATCH
 * 3. Специальные символы (*, +, -, NOT, AND, OR)
 * 4. Скобки и логические операторы
 * 
 * Решение: заменяем все спецсимволы на пробелы и оборачиваем
 * в двойные кавычки, что заставляет FTS5 искать фразу целиком,
 * а не разбирать её на операторы.
 * 
 * Примеры:
 *   escapeFts5Query('general-purpose') → '"general purpose"'
 *   escapeFts5Query('C++')             → '"C  "'
 *   escapeFts5Query('error (critical)') → '"error  critical "'
 *   escapeFts5Query('')                → '""'
 */
export function escapeFts5Query(query: string): string {
  // Экранируем все спецсимволы FTS5
  const cleaned = query
    .replace(/"/g, '')                    // убираем кавычки
    .replace(/[+\-*~()|&{}^]/g, ' ')     // заменяем спецсимволы на пробелы
    .replace(/\s+/g, ' ')                 // убираем множественные пробелы
    .trim();
  
  // Если после очистки ничего не осталось — возвращаем пустой запрос
  if (!cleaned) {
    return '""';
  }
  
  // Оборачиваем в кавычки для поиска фразы целиком
  return `"${cleaned}"`;
}
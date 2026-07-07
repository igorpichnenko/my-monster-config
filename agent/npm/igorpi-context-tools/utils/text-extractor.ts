/**
 * text-extractor.ts — Утилита для извлечения текста из сообщений.
 * 
 * v13: Вынесена из context.ts и agent-runner.ts
 *      для устранения дублирования кода (DRY).
 * 
 * Используется везде, где нужно извлечь текст из сообщения:
 * - context.ts — извлечение контекста родителя
 * - agent-runner.ts — извлечение текста для анализа
 * - session-memory.ts — извлечение текста для fact extraction
 * - failure-detector.ts — извлечение текста для детекции неудач
 * - compaction-summary.ts — извлечение текста для summary
 */

/**
 * Извлекает текстовое содержимое из сообщения.
 * 
 * Поддерживает форматы:
 * - Строка: "text" → "text"
 * - Массив блоков: [{ type: "text", text: "..." }, ...] → объединённый текст
 * - Объект с полем text: { text: "..." } → "..."
 * - null/undefined: → ""
 * 
 * Примеры:
 *   extractText("hello") → "hello"
 *   extractText([{ type: "text", text: "a" }, { type: "text", text: "b" }]) → "a\nb"
 *   extractText({ text: "hello" }) → "hello"
 *   extractText(null) → ""
 */
export function extractText(msg: any): string {
  if (!msg) return "";
  
  // Строка
  if (typeof msg.content === "string") return msg.content;
  
  // Массив блоков контента
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: any) => b && b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n");
  }
  
  // Объект с полем text
  if (msg.text) return msg.text;
  
  return "";
}
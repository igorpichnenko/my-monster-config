/**
 * priority.ts — Вычисление приоритета для tool_outputs.
 * 
 * Приоритет влияет на порядок результатов в ctx_search:
 * - Высокий приоритет = важные результаты (ошибки, тесты, git)
 * - Низкий приоритет = простые команды (ls, cat)
 */

export type Priority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Вычисляет приоритет для tool_output.
 * 
 * @param toolName - имя инструмента (bash, read, grep, find, ls)
 * @param output - вывод инструмента
 * @param args - аргументы инструмента (команда для bash, путь для read)
 * @returns приоритет от 1 до 10
 */
export function calculatePriority(
  toolName: string,
  output: string,
  args: string
): Priority {
  let priority = 5; // базовый приоритет
  
  // === Повышение приоритета ===
  
  // Ошибки и сбои — критически важны
  if (/\b(error|failed|failure|exception|fatal|crash|panic)\b/i.test(output)) {
    priority += 3;
  }
  
  // Предупреждения
  if (/\b(warning|warn|deprecated)\b/i.test(output)) {
    priority += 1;
  }
  
  // Git команды — важны для истории
  if (toolName === "bash" && /\bgit\b/.test(args)) {
    priority += 2;
  }
  
  // Тесты — важны для качества
  if (/\b(test|jest|vitest|pytest|mocha|ava)\b/i.test(args)) {
    priority += 2;
  }
  
  // Пакетные менеджеры — важны для зависимостей
  if (/\b(npm install|npm i|yarn add|pnpm add|npm update)\b/i.test(args)) {
    priority += 2;
  }
  
  // Docker — важен для инфраструктуры
  if (/\bdocker\b/.test(args)) {
    priority += 1;
  }
  
  // Сборка — важна для CI/CD
  if (/\b(build|compile|make|cargo|tsc|webpack|vite)\b/i.test(args)) {
    priority += 1;
  }
  
  // === Понижение приоритета ===
  
  // Простые команды просмотра — менее важны
  if (/^(ls|cat|echo|pwd|whoami|date|uname)\s/.test(args)) {
    priority -= 1;
  }
  
  // Поиск без ошибок — менее важен
  if ((toolName === "find" || toolName === "grep") && 
      !/\b(error|failed)\b/i.test(output)) {
    priority -= 1;
  }
  
  // Ограничиваем диапазон [1, 10]
  return Math.max(1, Math.min(10, priority)) as Priority;
}

/**
 * Возвращает эмодзи для приоритета (для отображения в UI).
 */
export function priorityEmoji(priority: Priority): string {
  if (priority >= 8) return "🔴"; // критический
  if (priority >= 6) return "🟠"; // высокий
  if (priority >= 4) return "🟡"; // средний
  return "🟢"; // низкий
}
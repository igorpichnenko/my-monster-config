/**
 * failure-detector.ts — Детектор неудачных подходов в сообщениях.
 * 
 * Анализирует сообщения и извлекает информацию о том, что не сработало.
 * 
 * v12: Улучшены паттерны — убраны ложные срабатывания на:
 * - "error TS2304" (ошибки компиляции — это нормально)
 * - "No results found" (не ошибка, а факт)
 * - "error:" в описаниях инструментов
 * Теперь требуется контекст — слово должно быть в осмысленной фразе.
 */

export interface FailureExtraction {
  approach: string;
  error: string;
  reason?: string;
  solution?: string;
}

// Паттерны для детекции неудач
// v12: Убраны слишком общие паттерны (просто "error", "ошибка")
// Теперь требуется контекст — фраза должна описывать реальную неудачу
const FAILURE_PATTERNS = [
  // Явные указания на неудачу — только в осмысленных фразах
  {
    pattern: /(?:не сработало|не получилось|не удалось|не работает|не запускается)/i,
    type: 'explicit_failure',
  },
  {
    pattern: /(?:failed to|couldn't|unable to|can't|cannot)\s+\w+/i,
    type: 'explicit_failure',
  },
  // Попытки и откаты
  {
    pattern: /(?:попробовал|tried|attempted|let me try|давай попробую)/i,
    type: 'attempt',
  },
  // Откаты изменений
  {
    pattern: /(?:откатил|reverted|rolled back|undo|отменил|отменяю)/i,
    type: 'rollback',
  },
  // Проблемы с компиляцией/запуском — только конкретные ошибки
  {
    pattern: /(?:compilation error|syntax error|runtime error|build failed|не компилируется|не запускается|compilation failed)/i,
    type: 'compilation_error',
  },
  // Неожиданное поведение
  {
    pattern: /(?:unexpected|неожиданно|странно|weird|odd|это странно|that's strange)/i,
    type: 'unexpected_behavior',
  },
  // Явные указания на ошибку подхода
  {
    pattern: /(?:это было ошибкой|wrong approach|неправильный подход|mistake|мой косяк|my mistake)/i,
    type: 'approach_error',
  },
];

// Паттерны для ИГНОРИРОВАНИЯ — это НЕ неудачи
const FALSE_POSITIVE_PATTERNS = [
  // Ошибки компиляции TypeScript — это нормальный вывод tsc
  /error TS\d+/,
  // "No results found" — это факт, а не ошибка
  /no results found/i,
  // "No matches" — тоже факт
  /no matches/i,
  // Описания инструментов с "error" в названии
  /(?:error|warning)\s*:\s*(?:description|type|level)/i,
  // ESLint/библиотечные правила
  /(?:eslint|prettier|biome)\s+(?:error|warning)/i,
  // HTTP статусы
  /\b(?:404|500|502|503)\s+(?:error|Not Found|Internal Server Error)/i,
];

/**
 * Проверяет, является ли строка ложным срабатыванием.
 */
function isFalsePositive(line: string): boolean {
  return FALSE_POSITIVE_PATTERNS.some(p => p.test(line));
}

/**
 * Извлекает информацию о неудаче из текста.
 * 
 * v12: Добавлена проверка на ложные срабатывания.
 */
export function extractFailure(text: string): FailureExtraction | null {
  const lines = text.split('\n');
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Пропускаем ложные срабатывания
    if (isFalsePositive(line)) {
      continue;
    }
    
    // Проверяем паттерны
    const hasFailure = FAILURE_PATTERNS.some(p => p.pattern.test(lowerLine));
    
    if (hasFailure) {
      // Пытаемся извлечь структуру
      const approachMatch = line.match(/(?:попробовал|tried|attempted)\s+(.+?)(?:,|\.|$)/i);
      const errorMatch = line.match(/(?:ошибка|error|failed|не сработало|не получилось)[:\s]+(.+?)(?:,|\.|$)/i);
      const reasonMatch = line.match(/(?:потому что|because|причина|так как|since)[:\s]+(.+?)(?:,|\.|$)/i);
      const solutionMatch = line.match(/(?:вместо этого|instead|решение|поэтому|so)[:\s]+(.+?)(?:,|\.|$)/i);
      
      if (approachMatch || errorMatch) {
        return {
          approach: approachMatch?.[1]?.trim() || line.slice(0, 150),
          error: errorMatch?.[1]?.trim() || line.slice(0, 150),
          reason: reasonMatch?.[1]?.trim(),
          solution: solutionMatch?.[1]?.trim(),
        };
      }
    }
  }
  
  return null;
}

/**
 * Анализирует сообщения и извлекает все неудачи.
 * 
 * v12: Анализирует только assistant сообщения с достаточным контекстом.
 */
export function extractFailuresFromMessages(messages: any[]): FailureExtraction[] {
  const failures: FailureExtraction[] = [];
  
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    
    const text = Array.isArray(msg.content)
      ? msg.content.map((c: any) => c.text || '').join(' ')
      : (typeof msg.content === 'string' ? msg.content : '');
    
    // Пропускаем слишком короткие сообщения (мало контекста)
    if (text.length < 50) continue;
    
    const failure = extractFailure(text);
    if (failure) {
      failures.push(failure);
    }
  }
  
  return failures;
}
/**
 * failure-detector.ts — Детектор неудачных подходов в сообщениях.
 * 
 * Анализирует сообщения и извлекает информацию о том, что не сработало.
 */

export interface FailureExtraction {
  approach: string;
  error: string;
  reason?: string;
  solution?: string;
}

// Паттерны для детекции неудач
const FAILURE_PATTERNS = [
  // Явные указания на неудачу
  {
    pattern: /(?:не сработало|failed|doesn't work|didn't work|broken|error|ошибка)/i,
    type: 'explicit_failure',
  },
  // Попытки и откаты
  {
    pattern: /(?:попробовал|tried|attempted|let me try|давай попробую)/i,
    type: 'attempt',
  },
  // Откаты изменений
  {
    pattern: /(?:откатил|reverted|rolled back|undo|отменил)/i,
    type: 'rollback',
  },
  // Проблемы с компиляцией/запуском
  {
    pattern: /(?:compilation error|syntax error|runtime error|не компилируется|не запускается)/i,
    type: 'compilation_error',
  },
  // Неожиданное поведение
  {
    pattern: /(?:unexpected|неожиданно|странно|weird|odd)/i,
    type: 'unexpected_behavior',
  },
];

/**
 * Извлекает информацию о неудаче из текста.
 */
export function extractFailure(text: string): FailureExtraction | null {
  const lines = text.split('\n');
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Проверяем паттерны
    const hasFailure = FAILURE_PATTERNS.some(p => p.pattern.test(lowerLine));
    
    if (hasFailure) {
      // Пытаемся извлечь структуру
      const approachMatch = line.match(/(?:попробовал|tried|attempted)\s+(.+?)(?:,|\.|$)/i);
      const errorMatch = line.match(/(?:ошибка|error|failed|не сработало)[:\s]+(.+?)(?:,|\.|$)/i);
      const reasonMatch = line.match(/(?:потому что|because|причина)[:\s]+(.+?)(?:,|\.|$)/i);
      const solutionMatch = line.match(/(?:вместо этого|instead|решение)[:\s]+(.+?)(?:,|\.|$)/i);
      
      if (approachMatch || errorMatch) {
        return {
          approach: approachMatch?.[1]?.trim() || line.slice(0, 100),
          error: errorMatch?.[1]?.trim() || line.slice(0, 100),
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
 */
export function extractFailuresFromMessages(messages: any[]): FailureExtraction[] {
  const failures: FailureExtraction[] = [];
  
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    
    const text = Array.isArray(msg.content)
      ? msg.content.map((c: any) => c.text || '').join(' ')
      : (typeof msg.content === 'string' ? msg.content : '');
    
    const failure = extractFailure(text);
    if (failure) {
      failures.push(failure);
    }
  }
  
  return failures;
}
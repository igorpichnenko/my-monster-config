/**
 * compaction-summary.ts — Утилита для генерации структурированного дампа компакции.
 * 
 * Используется как для main agent, так и для субагентов.
 * Извлекает ключевые файлы, решения и уроки из сообщений.
 * 
 * v12: Улучшено извлечение решений и уроков:
 *      - Извлекаем предложение целиком, а не первые 50 символов
 *      - Игнорируем отрицания ("not a decision", "не решение")
 *      - Добавлены более точные паттерны
 * v13: Улучшено извлечение файлов:
 *      - Regex проверяет что путь содержит '/' или начинается с './'
 *      - Исключены ложные срабатывания на случайных словах с .ts/.js
 *      - Добавлена валидация — путь должен выглядеть как путь файла
 */

export interface CompactionMeta {
  keyFiles: string[];
  keyDecisions: string[];
  keyLessons: string[];
}

export interface CompactionSummaryResult {
  detailed: string;
  meta: CompactionMeta;
}

/**
 * Извлекает предложение, содержащее ключевое слово.
 * 
 * v12: Вместо первых 50 символов извлекаем целое предложение.
 */
function extractSentence(text: string, keywordIndex: number): string {
  // Ищем границы предложения
  const sentenceEndPattern = /[.!?](\s|$)/;
  const sentenceStartPattern = /(?:^|[.!?]\s+)/;
  
  // Ищем конец предложения после ключевого слова
  const afterKeyword = text.slice(keywordIndex);
  const endMatch = afterKeyword.match(sentenceEndPattern);
  const endIndex = endMatch 
    ? keywordIndex + endMatch.index! + endMatch[0].length 
    : Math.min(keywordIndex + 200, text.length);
  
  // Ищем начало предложения до ключевого слова
  const beforeKeyword = text.slice(0, keywordIndex);
  const startMatches = Array.from(beforeKeyword.matchAll(new RegExp(sentenceStartPattern, 'g')));
  const startIndex = startMatches.length > 0 
    ? (startMatches[startMatches.length - 1].index || 0) + startMatches[startMatches.length - 1][0].length
    : Math.max(0, keywordIndex - 100);
  
  return text.slice(startIndex, endIndex).trim();
}

/**
 * Проверяет, является ли фраза отрицанием (не решение, не урок).
 */
function isNegation(text: string): boolean {
  const negationPatterns = [
    /\bnot\s+(a\s+)?decision\b/i,
    /\bno\s+decision\b/i,
    /\bне\s+(решение|вывод|урок)\b/i,
    /\bэто\s+не\s+(решение|вывод|урок)\b/i,
    /\bwithout\s+decision\b/i,
  ];
  
  return negationPatterns.some(p => p.test(text));
}

/**
 * v13: Проверяет, является ли строка реальным путём к файлу.
 * 
 * Путь считается валидным если:
 * - Содержит '/' (разделитель директорий)
 * - ИЛИ начинается с './' или '../'
 * - И заканчивается на известное расширение файла
 */
function isValidFilePath(path: string): boolean {
  // Должно содержать разделитель директорий
  if (!path.includes('/') && !path.includes('\\')) {
    return false;
  }
  
  // Не должно быть слишком коротким
  if (path.length < 3) {
    return false;
  }
  
  // Не должно содержать пробелы (кроме экранированных)
  if (/\s/.test(path) && !path.includes('\\ ')) {
    return false;
  }
  
  // Должно заканчиваться на известное расширение
  const validExtensions = /\.(ts|tsx|js|jsx|json|md|yaml|yml|html|css|scss|py|rb|go|rs|cpp|c|h|hpp|java|kt|swift)$/i;
  if (!validExtensions.test(path)) {
    return false;
  }
  
  return true;
}

/**
 * Генерирует структурированный дамп из messagesToSummarize.
 * Включает: ключевые решения, файлы, код, контекст — всё индексируется FTS5.
 * Также возвращает метаданные для сохранения в compaction_keywords.
 * 
 * v12: Улучшено извлечение решений и уроков.
 * v13: Улучшено извлечение файлов — добавлена валидация путей.
 */
export function generateCompactionDetailedSummary(
  messagesToSummarize: any[],
  tokensBefore: number
): CompactionSummaryResult {
  const sections: string[] = [];
  const meta: CompactionMeta = {
    keyFiles: [],
    keyDecisions: [],
    keyLessons: [],
  };

  // 1. Сводка
  sections.push(`## Context Summary`);
  const byRole = messagesToSummarize.reduce((acc, m) => {
    acc[m.role] = (acc[m.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  sections.push(
    `- Messages: ${messagesToSummarize.length} (${Object.entries(byRole).map(([r, c]) => `${c}x ${r}`).join(", ")})`
  );
  sections.push(`- Tokens before compaction: ${tokensBefore}`);

  // 2. Извлечённые решения и выводы
  const decisions: string[] = [];
  const lessons: string[] = [];
  
  // v12: Более точные паттерны для решений и уроков
  const decisionPatterns = [
    /\b(decided|decision|we'll use|we use|выбрали|решили|будем использовать|используем|приняли решение)\b/i,
  ];
  
  const lessonPatterns = [
    /\b(lesson|important|важно|проблема|запомни|не делай|избегай|mistake|ошибка была)\b/i,
  ];
  
  messagesToSummarize.forEach((m) => {
    const text = Array.isArray(m.content)
      ? m.content.map((c: any) => c.text || "").join(" ")
      : (typeof m.content === "string" ? m.content : "");
    
    // v12: Ищем ключевые слова и извлекаем предложение целиком
    for (const pattern of decisionPatterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const sentence = extractSentence(text, match.index);
        
        // Пропускаем отрицания и слишком короткие/длинные
        if (sentence.length > 20 && sentence.length < 300 && !isNegation(sentence)) {
          // Избегаем дубликатов
          if (!decisions.some(d => d.includes(sentence.slice(0, 50)))) {
            decisions.push(sentence);
            meta.keyDecisions.push(sentence.slice(0, 100)); // Для keywords — обрезаем
          }
        }
      }
    }
    
    for (const pattern of lessonPatterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const sentence = extractSentence(text, match.index);
        
        if (sentence.length > 20 && sentence.length < 300 && !isNegation(sentence)) {
          if (!lessons.some(l => l.includes(sentence.slice(0, 50)))) {
            lessons.push(sentence);
            meta.keyLessons.push(sentence.slice(0, 100));
          }
        }
      }
    }
  });

  if (decisions.length > 0) {
    sections.push(`\n## Key Decisions`);
    decisions.slice(0, 5).forEach((d, i) => {
      sections.push(`${i + 1}. ${d.trim()}`);
    });
  }

  if (lessons.length > 0) {
    sections.push(`\n## Lessons Learned`);
    lessons.slice(0, 3).forEach((l, i) => {
      sections.push(`${i + 1}. ${l.trim()}`);
    });
  }

  // 3. Файлы, которые читались/писались
  const files = new Set<string>();
  messagesToSummarize.forEach((m) => {
    const text = Array.isArray(m.content)
      ? m.content.map((c: any) => c.text || "").join(" ")
      : (typeof m.content === "string" ? m.content : "");
    
    // v13: Улучшенный regex для путей файлов
    // Ищем паттерны: read("path"), write('path'), edit(`path`)
    const fileOperationPattern = /(?:read|write|edit|open|save|modify|openFile|readFile|writeFile)\s*[\(]?\s*["'`]?([^\s"'`\)]+)["'`]?[\)]?/gi;
    const fileMatches = text.matchAll(fileOperationPattern);
    
    for (const match of fileMatches) {
      const file = match[1]?.trim();
      if (file && isValidFilePath(file)) {
        files.add(file);
        meta.keyFiles.push(file);
      }
    }
    
    // Ищем import/require — только относительные пути
    const importMatches = text.matchAll(/from\s+["']([^"']+)["']/g);
    for (const match of importMatches) {
      const path = match[1];
      if (path && (path.startsWith("./") || path.startsWith("../"))) {
        if (isValidFilePath(path)) {
          files.add(path);
          meta.keyFiles.push(path);
        }
      }
    }
  });

  if (files.size > 0) {
    sections.push(`\n## Affected Files`);
    sections.push([...files].slice(0, 20).map((f) => `- \`${f}\``).join("\n"));
  }

  // 4. Фрагменты кода
  const codeSnippets: string[] = [];
  messagesToSummarize.forEach((m) => {
    const text = Array.isArray(m.content)
      ? m.content.map((c: any) => c.text || "").join(" ")
      : (typeof m.content === "string" ? m.content : "");
    
    // Ищем блоки кода
    const codeBlocks = text.match(/```[\s\S]*?```/g);
    if (codeBlocks) {
      codeBlocks.forEach((block: string) => {
        const preview = block.slice(0, 300);
        codeSnippets.push(preview);
      });
    }
    // Ищем определения функций/классов
    const defs = text.match(/(?:function|class|export|interface|type)\s+\w+/g);
    if (defs) {
      defs.forEach((d: string) => {
        if (!codeSnippets.includes(d) && d.length > 10) codeSnippets.push(d);
      });
    }
  });

  if (codeSnippets.length > 0) {
    sections.push(`\n## Code Context`);
    codeSnippets.slice(0, 3).forEach((s, i) => {
      sections.push(`Snippet ${i + 1}:\n\`\`\`\n${s}\n\`\`\``);
    });
  }

  return { 
    detailed: sections.join("\n"), 
    meta 
  };
}
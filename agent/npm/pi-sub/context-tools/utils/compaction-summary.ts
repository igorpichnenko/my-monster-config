/**
 * compaction-summary.ts — Утилита для генерации структурированного дампа компакции.
 * 
 * Используется как для main agent, так и для субагентов.
 * Извлекает ключевые файлы, решения и уроки из сообщений.
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
 * Генерирует структурированный дамп из messagesToSummarize.
 * Включает: ключевые решения, файлы, код, контекст — всё индексируется FTS5.
 * Также возвращает метаданные для сохранения в compaction_keywords.
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
  
  messagesToSummarize.forEach((m) => {
    const text = Array.isArray(m.content)
      ? m.content.map((c: any) => c.text || "").join(" ")
      : (typeof m.content === "string" ? m.content : "");
    
    const lower = text.toLowerCase();
    
    if (lower.includes("decision") || lower.includes("решили") || lower.includes("решил")) {
      // Извлекаем короткую фразу (до 50 символов)
      const decision = text.slice(0, 50).trim();
      if (decision.length > 10) {
        decisions.push(decision);
        meta.keyDecisions.push(decision);
      }
    }
    
    if (lower.includes("lesson") || lower.includes("важно") || lower.includes("проблема")) {
      const lesson = text.slice(0, 50).trim();
      if (lesson.length > 10) {
        lessons.push(lesson);
        meta.keyLessons.push(lesson);
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
    
    // Ищем пути файлов
    const fileMatches = text.match(/(?:read|write|edit|open|save|modify|openFile|readFile|writeFile)\s*["']?([^\s"']+\.ts|tsx|js|json|md|yaml|yml)/gi);
    if (fileMatches) {
      fileMatches.forEach((match) => {
        const file = match.replace(/(?:read|write|edit|open|save|modify|openFile|readFile|writeFile)\s*["']?/, "").trim();
        if (file) {
          files.add(file);
          meta.keyFiles.push(file);
        }
      });
    }
    
    // Ищем import/require
    const importMatches = text.match(/from\s+["']([^"']+)["']/g);
    if (importMatches) {
      importMatches.forEach((match) => {
        const path = match.replace(/from\s+["']?/, "").replace(/["']/g, "");
        if (path.startsWith("./") || path.startsWith("../")) {
          files.add(path);
          meta.keyFiles.push(path);
        }
      });
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
      codeBlocks.forEach((block) => {
        const preview = block.slice(0, 300);
        codeSnippets.push(preview);
      });
    }
    // Ищем определения функций/классов
    const defs = text.match(/(?:function|class|export|interface|type)\s+\w+/g);
    if (defs) {
      defs.forEach((d) => {
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
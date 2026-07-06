/**
 * consolidation.ts — Автоматическая консолидация похожих записей в памяти.
 * 
 * Находит дубликаты и похожие записи, сливает их в одну.
 * 
 * v11: Консолидирует только факты из одного проекта
 * v12: Оптимизирован O(n²) алгоритм:
 *      - Уменьшен maxRecords по умолчанию до 500 (было 1000)
 *      - Добавлена индексация по первым словам для быстрого отсева
 *      - Добавлен ранний выход при достижении лимита групп
 */

import { MemoryDatabase, type SessionFact } from "./database.js";

export interface ConsolidationResult {
  groupsFound: number;
  recordsMerged: number;
  recordsDeleted: number;
}

/**
 * Вычисляет Jaccard similarity между двумя строками.
 * 
 * v12: Оптимизация — кэшируем Set слов, чтобы не создавать его повторно.
 */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  let intersection = 0;
  // Итерируем по меньшему множеству для скорости
  const [smaller, larger] = setA.size < setB.size ? [setA, setB] : [setB, setA];
  
  for (const word of smaller) {
    if (larger.has(word)) intersection++;
  }
  
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Извлекает ключевые слова из текста для индексации.
 * Берём первые 5 значимых слов (длина >= 4).
 */
function extractKeyWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .slice(0, 5);
}

/**
 * Находит группы похожих записей.
 * 
 * v12: Оптимизация:
 * - Предварительно вычисляем Set слов для каждого факта (не в двойном цикле)
 * - Используем индекс по ключевым словам для быстрого отсева
 * - Добавлен ранний выход при достижении лимита групп
 */
function findSimilarGroups(
  facts: SessionFact[],
  threshold: number = 0.7,
  maxGroups: number = 100
): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  const processed = new Set<number>();
  
  // v12: Предварительно вычисляем Set слов и ключевые слова для каждого факта
  const factSets = facts.map(f => 
    new Set(f.content.toLowerCase().split(/\s+/).filter(Boolean))
  );
  const factKeyWords = facts.map(f => new Set(extractKeyWords(f.content)));
  
  // v12: Индекс по ключевым словам — для быстрого поиска кандидатов
  const keywordIndex = new Map<string, number[]>();
  for (let i = 0; i < facts.length; i++) {
    for (const word of factKeyWords[i]) {
      if (!keywordIndex.has(word)) {
        keywordIndex.set(word, []);
      }
      keywordIndex.get(word)!.push(i);
    }
  }
  
  for (let i = 0; i < facts.length; i++) {
    if (processed.has(i)) continue;
    
    // Ранний выход при достижении лимита групп
    if (groups.size >= maxGroups) {
      console.log(`[pi-memory] 🔄 Reached max groups limit (${maxGroups}), stopping early`);
      break;
    }
    
    const group: number[] = [i];
    processed.add(i);
    
    // v12: Используем индекс для поиска кандидатов
    const candidates = new Set<number>();
    for (const word of factKeyWords[i]) {
      const indices = keywordIndex.get(word) || [];
      for (const idx of indices) {
        if (idx > i && !processed.has(idx) && facts[i].fact_type === facts[idx].fact_type) {
          candidates.add(idx);
        }
      }
    }
    
    // Проверяем только кандидатов (не все факты)
    for (const j of candidates) {
      if (processed.has(j)) continue;
      
      // Сравниваем только записи одного типа
      if (facts[i].fact_type !== facts[j].fact_type) continue;
      
      // v12: Используем предвычисленные Set
      const similarity = jaccardSimilarity(factSets[i], factSets[j]);
      
      if (similarity >= threshold) {
        group.push(j);
        processed.add(j);
      }
    }
    
    if (group.length > 1) {
      groups.set(i, group);
    }
  }
  
  return groups;
}

/**
 * Сливает несколько записей в одну.
 */
function mergeFacts(facts: SessionFact[]): string {
  // Берём самую длинную запись как основу
  const longest = facts.reduce((a, b) => 
    a.content.length > b.content.length ? a : b
  );
  
  // Добавляем уникальную информацию из других записей
  const additions: string[] = [];
  
  // v12: Предвычисляем Set для longest
  const longestSet = new Set(longest.content.toLowerCase().split(/\s+/).filter(Boolean));
  
  for (const fact of facts) {
    if (fact.id !== longest.id) {
      const factSet = new Set(fact.content.toLowerCase().split(/\s+/).filter(Boolean));
      const similarity = jaccardSimilarity(longestSet, factSet);
      
      if (similarity < 0.9) {
        additions.push(fact.content);
      }
    }
  }
  
  if (additions.length > 0) {
    return `${longest.content}\n\nAlso: ${additions.join('; ')}`;
  }
  
  return longest.content;
}

/**
 * Выполняет консолидацию записей в БД.
 * 
 * v11: Если указан projectPath — консолидирует только факты этого проекта.
 * v12: Уменьшен maxRecords по умолчанию до 500 (было 1000).
 */
export function consolidateMemory(
  db: MemoryDatabase,
  options: {
    threshold?: number;
    maxRecords?: number;
    dryRun?: boolean;
    projectPath?: string;
  } = {}
): ConsolidationResult {
  // v12: Уменьшен maxRecords по умолчанию до 500
  const { threshold = 0.7, maxRecords = 500, dryRun = false, projectPath } = options;
  
  const stats = db.getStats();
  
  if (stats.sessionFacts < 100) {
    console.log(`[pi-memory] 🔄 Not enough records to consolidate (${stats.sessionFacts} < 100)`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  // v11: Получаем факты только для текущего проекта
  const facts = projectPath 
    ? db.getFactsByProject(projectPath).slice(0, maxRecords)
    : db.getRecentFacts(maxRecords);
  
  if (facts.length < 100) {
    console.log(`[pi-memory] 🔄 Not enough records to consolidate (${facts.length} < 100)`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  console.log(
    `[pi-memory] 🔄 Starting consolidation of ${facts.length} facts` +
    (projectPath ? ` for project ${projectPath}` : '') +
    `...`
  );
  
  // v12: Находим группы похожих записей с оптимизацией
  const groups = findSimilarGroups(facts, threshold);
  
  if (groups.size === 0) {
    console.log(`[pi-memory] 🔄 No similar groups found`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  console.log(`[pi-memory] 🔄 Found ${groups.size} groups of similar records`);
  
  let recordsMerged = 0;
  let recordsDeleted = 0;
  
  if (!dryRun) {
    // Сливаем каждую группу
    for (const [mainIndex, indices] of groups) {
      const groupFacts = indices.map(i => facts[i]);
      const mergedContent = mergeFacts(groupFacts);
      
      // Обновляем главную запись
      const mainFact = facts[mainIndex];
      db.updateFactContent(mainFact.id, mergedContent);
      
      // Удаляем остальные записи
      for (let i = 1; i < groupFacts.length; i++) {
        db.deleteFact(groupFacts[i].id);
        recordsDeleted++;
      }
      
      recordsMerged += groupFacts.length;
    }
  }
  
  const result = {
    groupsFound: groups.size,
    recordsMerged,
    recordsDeleted,
  };
  
  console.log(
    `[pi-memory] 🔄 Consolidation complete: ` +
    `${result.groupsFound} groups, ` +
    `${result.recordsMerged} records merged, ` +
    `${result.recordsDeleted} records deleted`
  );
  
  return result;
}
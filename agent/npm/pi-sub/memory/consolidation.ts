/**
 * consolidation.ts — Автоматическая консолидация похожих записей в памяти.
 * 
 * Находит дубликаты и похожие записи, сливает их в одну.
 * 
 * v11: Консолидирует только факты из одного проекта
 */

import { MemoryDatabase, type SessionFact } from "./database.js";

export interface ConsolidationResult {
  groupsFound: number;
  recordsMerged: number;
  recordsDeleted: number;
}

/**
 * Вычисляет Jaccard similarity между двумя строками.
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Находит группы похожих записей.
 */
function findSimilarGroups(
  facts: SessionFact[],
  threshold: number = 0.7
): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  const processed = new Set<number>();
  
  for (let i = 0; i < facts.length; i++) {
    if (processed.has(i)) continue;
    
    const group: number[] = [i];
    processed.add(i);
    
    for (let j = i + 1; j < facts.length; j++) {
      if (processed.has(j)) continue;
      
      // Сравниваем только записи одного типа
      if (facts[i].fact_type !== facts[j].fact_type) continue;
      
      const similarity = jaccardSimilarity(facts[i].content, facts[j].content);
      
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
  
  for (const fact of facts) {
    if (fact.id !== longest.id) {
      // Проверяем есть ли уникальная информация
      const similarity = jaccardSimilarity(longest.content, fact.content);
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
 *      Иначе — консолидирует все факты (для обратной совместимости).
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
  const { threshold = 0.7, maxRecords = 1000, dryRun = false, projectPath } = options;
  
  const stats = db.getStats();
  
  if (stats.sessionFacts < 100) {
    console.log(`[pi-sub] 🔄 Not enough records to consolidate (${stats.sessionFacts} < 100)`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  // v11: Получаем факты только для текущего проекта
 const facts = projectPath 
  ? db.getFactsByProject(projectPath, maxRecords)  // ← передаём лимит напрямую
  : db.getRecentFacts(maxRecords);
  
  if (facts.length < 100) {
    console.log(`[pi-sub] 🔄 Not enough records to consolidate (${facts.length} < 100)`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  console.log(
    `[pi-sub] 🔄 Starting consolidation of ${facts.length} facts` +
    (projectPath ? ` for project ${projectPath}` : '') +
    `...`
  );
  
  // Находим группы похожих записей
  const groups = findSimilarGroups(facts, threshold);
  
  if (groups.size === 0) {
    console.log(`[pi-sub] 🔄 No similar groups found`);
    return { groupsFound: 0, recordsMerged: 0, recordsDeleted: 0 };
  }
  
  console.log(`[pi-sub] 🔄 Found ${groups.size} groups of similar records`);
  
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
    `[pi-sub] 🔄 Consolidation complete: ` +
    `${result.groupsFound} groups, ` +
    `${result.recordsMerged} records merged, ` +
    `${result.recordsDeleted} records deleted`
  );
  
  return result;
}
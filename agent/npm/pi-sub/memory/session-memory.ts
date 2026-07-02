/**
 * session-memory.ts — Автоматическое извлечение фактов из сессий.
 * 
 * Фаза 4A: Извлекает факты (решения, уроки, предпочтения) из сообщений
 * сессии и сохраняет их в БД для использования в будущих сессиях.
 */

import { MemoryDatabase } from "./database.js";
import { logger } from "../context-tools/utils/logger.js";

/** Ключевые слова для определения типа факта */
const FACT_PATTERNS: Record<string, RegExp[]> = {
  decision: [
    /\b(решени[ея]|decision|выбрали|будем использовать|используем|приняли решение)\b/i,
    /\b(выбор пал на|остановились на|утвердили)\b/i,
    /\b(decided to|chose|we'll use|we use)\b/i,
  ],
  lesson: [
    /\b(важно|lesson|урок|запомни|не делай|не используй|избегай)\b/i,
    /\b(ошибка была|не повторяй|в следующий раз)\b/i,
    /\b(important|remember|don't|avoid|mistake)\b/i,
  ],
  preference: [
    /\b(предпочитаю|preference|нравится|хочу чтобы|мне нужно)\b/i,
    /\b(всегда используй|никогда не используй)\b/i,
    /\b(prefer|like|want|always use|never use)\b/i,
  ],
  architecture: [
    /\b(архитектура|architecture|структура проекта|модули|компоненты)\b/i,
    /\b(слой|layer|паттерн|pattern|дизайн)\b/i,
    /\b(структура директорий|организация кода)\b/i,
  ],
  api: [
    /\b(api|endpoint|маршрут|route|метод)\b/i,
    /\b(rest|graphql|websocket|http)\b/i,
    /\b(аутентификация|auth|токен|token)\b/i,
  ],
};

/** Максимальная длина факта (символы) */
const MAX_FACT_LENGTH = 500;
/** Минимальная длина факта (символы) */
const MIN_FACT_LENGTH = 20;

export class SessionMemory {
  /** Хэш уже сохранённых фактов в текущей сессии (для избежания дубликатов) */
  private savedFactHashes = new Set<string>();
  
  /** ID текущей сессии */
  private currentSessionId: string | null = null;
  
  constructor(private db: MemoryDatabase) {}
  
  /** Установить ID текущей сессии */
  setSessionId(sessionId: string): void {
    if (this.currentSessionId !== sessionId) {
      this.savedFactHashes.clear();
      this.currentSessionId = sessionId;
      logger.info(`Session memory: new session ${sessionId}`);
    }
  }
  
  /** Получить ID текущей сессии */
  getSessionId(): string | null {
    return this.currentSessionId;
  }
  
  /** 
   * Убедиться что ID сессии установлен.
   * Если нет — генерирует новый.
   */
  ensureSessionId(): string {
    if (!this.currentSessionId) {
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.setSessionId(sessionId);
      logger.info(`Session memory: auto-generated session ID ${sessionId}`);
    }
    return this.currentSessionId!;
  }
  
  /**
   * Извлечь факты из сообщений сессии и сохранить в БД.
   */
  extractAndSaveFacts(messages: any[]): number {
    // Убеждаемся что ID сессии установлен
    this.ensureSessionId();
    
    const allFacts: Array<{ type: string; content: string }> = [];
    
    for (const msg of messages) {
      const text = this.extractText(msg);
      if (!text) continue;
      
      const extracted = this.extractFactsFromText(text);
      allFacts.push(...extracted);
    }
    
    const unique = this.deduplicateFacts(allFacts);
    
    let count = 0;
    for (const fact of unique) {
      try {
        this.db.saveFact({
          sessionId: this.currentSessionId!,
          factType: fact.type as any,
          content: fact.content,
        });
        this.savedFactHashes.add(this.hashFact(fact));
        count++;
      } catch (err) {
        logger.error(`Failed to save fact: ${err}`);
      }
    }
    
    if (count > 0) {
      logger.info(`Session memory: saved ${count} facts from ${messages.length} messages`);
    }
    
    return count;
  }
  
  /** Извлечь текст из сообщения */
  private extractText(msg: any): string {
    if (!msg) return "";
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((b: any) => b && b.type === "text" && b.text)
        .map((b: any) => b.text)
        .join("\n");
    }
    if (msg.text) return msg.text;
    return "";
  }
  
  /** Извлечь факты из текста по ключевым словам */
  private extractFactsFromText(text: string): Array<{ type: string; content: string }> {
    const facts: Array<{ type: string; content: string }> = [];
    const sentences = text.split(/[.!?]\s+/);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      
      if (trimmed.length < MIN_FACT_LENGTH || trimmed.length > MAX_FACT_LENGTH) {
        continue;
      }
      
      if (!this.isMeaningfulSentence(trimmed)) {
        continue;
      }
      
      for (const [type, patterns] of Object.entries(FACT_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(trimmed)) {
            facts.push({ type, content: trimmed });
            break;
          }
        }
      }
    }
    
    return facts;
  }
  
  /** Проверить что предложение осмысленное */
  private isMeaningfulSentence(sentence: string): boolean {
    if (/^\s*(import|export|const|let|var|function|class|if|for|while|return)\s/.test(sentence)) {
      return false;
    }
    if (/^[\s\S]*\/[\w\-\.]+\s*$/.test(sentence) && sentence.includes("/")) {
      return false;
    }
    if (/^[\d\s.,]+$/.test(sentence)) {
      return false;
    }
    if (!/[а-яёa-z]{3,}/i.test(sentence)) {
      return false;
    }
    return true;
  }
  
  /** Удалить дубликаты фактов */
  private deduplicateFacts(facts: Array<{ type: string; content: string }>): Array<{ type: string; content: string }> {
    const seen = new Set<string>();
    return facts.filter(f => {
      const hash = this.hashFact(f);
      if (this.savedFactHashes.has(hash)) return false;
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }
  
  /** Создать хэш факта для дедупликации */
  private hashFact(fact: { type: string; content: string }): string {
    return `${fact.type}:${fact.content.toLowerCase().replace(/\s+/g, " ").trim()}`;
  }
  
  /** Добавить факт вручную (для команды /memory-add) */
  addManualFact(factType: string, content: string): number {
    // Убеждаемся что ID сессии установлен
    this.ensureSessionId();
    
    const validTypes = ["decision", "lesson", "preference", "architecture", "api"];
    if (!validTypes.includes(factType)) {
      throw new Error(`Invalid fact type: ${factType}. Must be one of: ${validTypes.join(", ")}`);
    }
    
    return this.db.saveFact({
      sessionId: this.currentSessionId!,
      factType: factType as any,
      content,
    });
  }
  
  /** 
   * Получить релевантные факты для промпта.
   * Улучшенная версия: ищет по отдельным словам и агрегирует результаты.
   */
  getRelevantFacts(query: string, limit: number = 5): any[] {
    try {
      // 1. Пробуем поиск по всему запросу
      const fullResults = this.db.searchFacts(query, limit);
      if (fullResults.length >= limit) {
        return fullResults;
      }
      
      // 2. Извлекаем ключевые слова из запроса
      const keywords = this.extractKeywords(query);
      
      // 3. Ищем по каждому ключевому слову
      const allResults = new Map<number, any>();
      
      // Добавляем результаты полнотекстового поиска
      for (const fact of fullResults) {
        allResults.set(fact.id, fact);
      }
      
      // Ищем по ключевым словам
      for (const keyword of keywords) {
        if (allResults.size >= limit) break;
        
        try {
          // FTS5 поиск
          const keywordResults = this.db.searchFacts(keyword, limit);
          for (const fact of keywordResults) {
            if (allResults.size >= limit) break;
            allResults.set(fact.id, fact);
          }
        } catch (err) {
          // Если FTS5 не работает с этим словом — пробуем LIKE
          try {
            const likeResults = this.db.searchFactsLike(`%${keyword}%`, limit);
            for (const fact of likeResults) {
              if (allResults.size >= limit) break;
              allResults.set(fact.id, fact);
            }
          } catch (likeErr) {
            // Игнорируем ошибки LIKE
          }
        }
      }
      
      // 4. Если всё ещё мало — возвращаем последние факты
      if (allResults.size < limit) {
        const recentFacts = this.db.getRecentFacts(limit - allResults.size);
        for (const fact of recentFacts) {
          if (allResults.size >= limit) break;
          allResults.set(fact.id, fact);
        }
      }
      
      return Array.from(allResults.values()).slice(0, limit);
    } catch (err) {
      logger.error(`Failed to search facts: ${err}`);
      return [];
    }
  }
  
  /**
   * Извлечь ключевые слова из запроса.
   * Убирает стоп-слова и короткие слова.
   */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      "и", "в", "на", "с", "по", "для", "к", "от", "о", "а", "но", "не",
      "and", "the", "in", "on", "at", "to", "for", "of", "a", "an", "is",
      "я", "ты", "он", "она", "мы", "вы", "они", "это", "то", "что", "как",
    ]);
    
    // Разбиваем на слова, убираем пунктуацию
    const words = query
      .toLowerCase()
      .replace(/[^\wа-яёa-z0-9\s-]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.has(w));
    
    // Убираем дубликаты
    return Array.from(new Set(words));
  }
}

/** Singleton экземпляр */
let sessionMemoryInstance: SessionMemory | null = null;

export function getSessionMemory(db: MemoryDatabase): SessionMemory {
  if (!sessionMemoryInstance) {
    sessionMemoryInstance = new SessionMemory(db);
  }
  return sessionMemoryInstance;
}

export function resetSessionMemory(): void {
  sessionMemoryInstance = null;
}
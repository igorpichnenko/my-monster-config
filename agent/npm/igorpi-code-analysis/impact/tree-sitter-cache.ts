/**
 * tree-sitter-cache.ts — Кэш результатов tree-sitter анализа
 * 
 * Кэширует:
 * - Результаты парсинга файлов (imports, symbols, exports)
 * - Содержимое файлов (readFileSync)
 * 
 * Инвалидация по mtime файла.
 * Ускоряет повторные вызовы /deps, /unused, /duplicates в 10-100x.
 */

import { statSync, readFileSync } from "node:fs";
import { TreeSitterAnalyzer, type TreeSitterAnalysis } from "./tree-sitter-analyzer.js";


interface CacheEntry {
  mtime: number;
  analysis: TreeSitterAnalysis;
}

interface FileContentEntry {
  mtime: number;
  content: string;
}

export class TreeSitterCache {
  private analysisCache = new Map<string, CacheEntry>();
  private contentCache = new Map<string, FileContentEntry>();
  private hitCount = 0;
  private missCount = 0;

  /**
   * Получить анализ файла из кэша или перепарсить
   */
  getAnalysis(filePath: string, language: "typescript" | "python" | "cpp"): TreeSitterAnalysis {
    let mtime: number;
    try {
      mtime = statSync(filePath).mtimeMs;
    } catch {
      return { imports: [], symbols: [], exports: [] };
    }

    const cached = this.analysisCache.get(filePath);
    
    if (cached && cached.mtime === mtime) {
      this.hitCount++;
      return cached.analysis;
    }

    this.missCount++;
    const analyzer = new TreeSitterAnalyzer(language);
    const analysis = analyzer.analyzeFile(filePath);
    
    this.analysisCache.set(filePath, { mtime, analysis });
    
    return analysis;
  }

  /**
   * Получить содержимое файла из кэша или прочитать
   */
  getFileContent(filePath: string): string | null {
    let mtime: number;
    try {
      mtime = statSync(filePath).mtimeMs;
    } catch {
      return null;
    }

    const cached = this.contentCache.get(filePath);
    
    if (cached && cached.mtime === mtime) {
      return cached.content;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      this.contentCache.set(filePath, { mtime, content });
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Инвалидировать кэш для конкретного файла
   */
  invalidate(filePath: string): void {
    this.analysisCache.delete(filePath);
    this.contentCache.delete(filePath);
  }

  /**
   * Инвалидировать весь кэш
   */
  clear(): void {
    this.analysisCache.clear();
    this.contentCache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Получить статистику кэша
   */
  getStats(): { 
    analysisSize: number; 
    contentSize: number;
    hits: number; 
    misses: number; 
    hitRate: number; 
  } {
    const total = this.hitCount + this.missCount;
    return {
      analysisSize: this.analysisCache.size,
      contentSize: this.contentCache.size,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }
}

// Singleton
let cacheInstance: TreeSitterCache | null = null;

export function getTreeSitterCache(): TreeSitterCache {
  if (!cacheInstance) {
    cacheInstance = new TreeSitterCache();
  }
  return cacheInstance;
}

export function resetTreeSitterCache(): void {
  cacheInstance = null;
}
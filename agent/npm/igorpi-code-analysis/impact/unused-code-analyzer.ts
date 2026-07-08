/**
 * unused-code-analyzer.ts — Поиск неиспользуемого кода через tree-sitter
 * 
 * Анализирует:
 * - Неиспользуемые функции
 * - Неиспользуемые классы
 * - Неиспользуемые переменные
 * - Неиспользуемые импорты
 * 
 * v3: Добавлен кэш + очистка старых записей перед анализом
 */

import { type SymbolInfo } from "./tree-sitter-analyzer.js";
import { getTreeSitterCache } from "./tree-sitter-cache.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase } from "../../igorpi-memory/index.js";
import { log } from "../lib/logger.js";

export interface UnusedSymbol {
  filePath: string;
  symbolName: string;
  symbolType: string;
  line: number;
  confidence: number;
}

export class UnusedCodeAnalyzer {
  private projectPath: string;
  private memoryDb: MemoryDatabase;
  private cache = getTreeSitterCache();

  constructor(projectPath: string, memoryDb: MemoryDatabase) {
    this.projectPath = projectPath;
    this.memoryDb = memoryDb;
  }

  /**
   * Анализирует проект на неиспользуемый код
   */
  async analyzeProject(): Promise<UnusedSymbol[]> {
    log(`🔍 Analyzing unused code with tree-sitter...`);

    // v3: Очищаем старые записи
    const deleted = this.memoryDb.deleteUnusedByProject(this.projectPath);
    log(`🗑️ Cleared ${deleted} old unused symbols`);

    const files = this.getAllFiles(this.projectPath);
    const allSymbols = new Map<string, SymbolInfo[]>();
    const allUsages = new Map<string, Set<string>>();

    // Собираем все символы и использования
    for (const file of files) {
      const ext = file.split(".").pop()?.toLowerCase();
      let language: "typescript" | "python" | "cpp" | null = null;

      if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
        language = "typescript";
      } else if (ext === "py" || ext === "pyi") {
        language = "python";
      } else if (ext === "cpp" || ext === "c" || ext === "h" || ext === "hpp") {
        language = "cpp";
      }

      if (!language) continue;

      try {
        // Используем кэш для tree-sitter анализа
        const analysis = this.cache.getAnalysis(file, language);
        allSymbols.set(file, analysis.symbols);

        // Используем кэш для чтения файла
        const content = this.cache.getFileContent(file);
        if (!content) continue;

        // Собираем использования символов
        for (const symbol of analysis.symbols) {
          if (!allUsages.has(symbol.name)) {
            allUsages.set(symbol.name, new Set());
          }
          
          const regex = new RegExp(`\\b${symbol.name}\\b`, "g");
          const matches = content.match(regex);
          if (matches && matches.length > 1) {
            allUsages.get(symbol.name)!.add(file);
          }
        }
      } catch (err) {
        console.error(`[igorpi-code-analysis] Failed to analyze ${file}:`, err);
      }
    }

    // Ищем неиспользуемые символы
    const unused: UnusedSymbol[] = [];

    for (const [file, symbols] of allSymbols) {
      for (const symbol of symbols) {
        if (symbol.exported) continue;

        const usages = allUsages.get(symbol.name);
        if (!usages || usages.size === 0) {
          unused.push({
            filePath: file,
            symbolName: symbol.name,
            symbolType: symbol.type,
            line: symbol.line,
            confidence: 0.95,
          });

          this.memoryDb.saveUnusedCode({
            projectPath: this.projectPath,
            filePath: file,
            symbolName: symbol.name,
            symbolType: symbol.type as any,
            line: symbol.line,
            confidence: 0.95,
            sessionId: "current",
          });
        }
      }
    }

    const stats = this.cache.getStats();
    log(`✅ Found ${unused.length} unused symbols`);
    log(`📊 Cache: ${stats.contentSize} files cached, ${stats.hits} hits, ${stats.misses} misses`);
    
    return unused;
  }

  /**
   * Рекурсивно получает все файлы проекта
   */
  private getAllFiles(dir: string, files: string[] = []): string[] {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (["node_modules", "dist", "build", ".git", ".pi"].includes(entry)) {
          continue;
        }
        this.getAllFiles(fullPath, files);
      } else {
        if (/\.(ts|tsx|js|jsx|py|pyi|cpp|c|h|hpp)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    }
    
    return files;
  }
}
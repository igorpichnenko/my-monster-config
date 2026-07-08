/**
 * code-duplicates-analyzer.ts — Поиск дубликатов кода
 * 
 * Использует хеширование для поиска похожих блоков кода.
 * Поддерживает:
 * - TypeScript/JavaScript
 * - Python
 * - C++
 * 
 * v4: Оптимизации
 * - Merge overlapping duplicates
 * - Skip trivial blocks
 * - Min lines = 15
 * - Кэш чтения файлов
 * - Очистка старых записей перед анализом
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MemoryDatabase } from "../../igorpi-memory/index.js";
import { getTreeSitterCache } from "./tree-sitter-cache.js";
import { log } from "../lib/logger.js";

export interface CodeDuplicate {
  filePath1: string;
  filePath2: string;
  lineStart1: number;
  lineEnd1: number;
  lineStart2: number;
  lineEnd2: number;
  linesCount: number;
  tokensCount: number;
  similarity: number;
}

export class CodeDuplicatesAnalyzer {
  private projectPath: string;
  private memoryDb: MemoryDatabase;
  private minLines: number;
  private minSimilarity: number;
  private cache = getTreeSitterCache();

  constructor(projectPath: string, memoryDb: MemoryDatabase, minLines: number = 15, minSimilarity: number = 0.8) {
    this.projectPath = projectPath;
    this.memoryDb = memoryDb;
    this.minLines = minLines;
    this.minSimilarity = minSimilarity;
  }

  /**
   * Анализирует проект на дубликаты кода
   */
  async analyzeProject(): Promise<CodeDuplicate[]> {
    log(`🔍 Analyzing code duplicates...`);

    // v4: Очищаем старые записи
    const deleted = this.memoryDb.deleteDuplicatesByProject(this.projectPath);
    log(`🗑️ Cleared ${deleted} old duplicates`);

    const files = this.getAllFiles(this.projectPath);
    const fileBlocks = new Map<string, { lines: string[]; hashes: Map<string, number[]> }>();

    // Собираем блоки кода из каждого файла (с кэшем)
    for (const file of files) {
      try {
        const content = this.cache.getFileContent(file);
        if (!content) continue;
        
        const lines = content.split("\n");
        const hashes = this.computeBlockHashes(lines);
        fileBlocks.set(file, { lines, hashes });
      } catch (err) {
        console.error(`[igorpi-code-analysis] Failed to read ${file}:`, err);
      }
    }

    // Ищем дубликаты между файлами
    const rawDuplicates: CodeDuplicate[] = [];
    const fileArray = Array.from(fileBlocks.entries());

    for (let i = 0; i < fileArray.length; i++) {
      for (let j = i + 1; j < fileArray.length; j++) {
        const [file1, blocks1] = fileArray[i];
        const [file2, blocks2] = fileArray[j];

        const fileDups = this.findDuplicatesBetweenFiles(file1, blocks1, file2, blocks2);
        rawDuplicates.push(...fileDups);
      }
    }

    const duplicates = this.mergeOverlappingDuplicates(rawDuplicates);

    for (const dup of duplicates) {
      this.memoryDb.saveDuplicate({
        projectPath: this.projectPath,
        filePath1: dup.filePath1,
        filePath2: dup.filePath2,
        lineStart1: dup.lineStart1,
        lineEnd1: dup.lineEnd1,
        lineStart2: dup.lineStart2,
        lineEnd2: dup.lineEnd2,
        linesCount: dup.linesCount,
        tokensCount: dup.tokensCount,
        similarity: dup.similarity,
        sessionId: "current",
      });
    }

    const stats = this.cache.getStats();
    log(`✅ Found ${duplicates.length} duplicate blocks (after merging)`);
    log(`📊 Cache: ${stats.contentSize} files cached`);
    
    return duplicates;
  }

  private mergeOverlappingDuplicates(duplicates: CodeDuplicate[]): CodeDuplicate[] {
    if (duplicates.length === 0) return [];

    const groups = new Map<string, CodeDuplicate[]>();
    for (const dup of duplicates) {
      const key = `${dup.filePath1}|${dup.filePath2}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(dup);
    }

    const merged: CodeDuplicate[] = [];

    for (const [_, group] of groups) {
      group.sort((a, b) => a.lineStart1 - b.lineStart1);

      let current = group[0];

      for (let i = 1; i < group.length; i++) {
        const next = group[i];

        if (next.lineStart1 <= current.lineEnd1 + 1 && next.lineStart2 <= current.lineEnd2 + 1) {
          current = {
            filePath1: current.filePath1,
            filePath2: current.filePath2,
            lineStart1: current.lineStart1,
            lineEnd1: Math.max(current.lineEnd1, next.lineEnd1),
            lineStart2: current.lineStart2,
            lineEnd2: Math.max(current.lineEnd2, next.lineEnd2),
            linesCount: Math.max(current.lineEnd1, next.lineEnd1) - current.lineStart1 + 1,
            tokensCount: 0,
            similarity: Math.max(current.similarity, next.similarity),
          };
        } else {
          current.linesCount = current.lineEnd1 - current.lineStart1 + 1;
          current.tokensCount = this.countTokensFromFile(current.filePath1, current.lineStart1, current.lineEnd1);
          merged.push(current);
          current = next;
        }
      }

      current.linesCount = current.lineEnd1 - current.lineStart1 + 1;
      current.tokensCount = this.countTokensFromFile(current.filePath1, current.lineStart1, current.lineEnd1);
      merged.push(current);
    }

    return merged.filter(d => d.linesCount >= this.minLines);
  }

  private countTokensFromFile(filePath: string, lineStart: number, lineEnd: number): number {
    const content = this.cache.getFileContent(filePath);
    if (!content) return 0;
    
    const lines = content.split("\n");
    const block = lines.slice(lineStart - 1, lineEnd).join("\n");
    return this.countTokens(block);
  }

  private computeBlockHashes(lines: string[]): Map<string, number[]> {
    const hashes = new Map<string, number[]>();
    const windowSize = this.minLines;

    for (let i = 0; i <= lines.length - windowSize; i++) {
      const block = lines.slice(i, i + windowSize).join("\n");
      
      if (this.isTrivialBlock(block)) continue;
      
      const normalized = this.normalizeCode(block);
      const hash = createHash("md5").update(normalized).digest("hex");

      if (!hashes.has(hash)) {
        hashes.set(hash, []);
      }
      hashes.get(hash)!.push(i + 1);
    }

    return hashes;
  }

  private isTrivialBlock(code: string): boolean {
    const lines = code.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length === 0) return true;

    const trivialPatterns = [
      /^import\s+/,
      /^from\s+/,
      /^require\(/,
      /^#include\s+/,
      /^\/\//,
      /^\/\*/,
      /^\*/,
      /^#/,
      /^export\s+/,
    ];

    const trivialCount = lines.filter(line => 
      trivialPatterns.some(pattern => pattern.test(line))
    ).length;

    return trivialCount / lines.length > 0.8;
  }

  private normalizeCode(code: string): string {
    return code
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/#.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private findDuplicatesBetweenFiles(
    file1: string,
    blocks1: { lines: string[]; hashes: Map<string, number[]> },
    file2: string,
    blocks2: { lines: string[]; hashes: Map<string, number[]> }
  ): CodeDuplicate[] {
    const duplicates: CodeDuplicate[] = [];

    for (const [hash, lines1] of blocks1.hashes) {
      const lines2 = blocks2.hashes.get(hash);
      if (!lines2) continue;

      for (const line1 of lines1) {
        for (const line2 of lines2) {
          if (file1 === file2 && Math.abs(line1 - line2) < this.minLines) {
            continue;
          }

          const similarity = this.computeSimilarity(
            blocks1.lines.slice(line1 - 1, line1 - 1 + this.minLines),
            blocks2.lines.slice(line2 - 1, line2 - 1 + this.minLines)
          );

          if (similarity >= this.minSimilarity) {
            duplicates.push({
              filePath1: file1,
              filePath2: file2,
              lineStart1: line1,
              lineEnd1: line1 + this.minLines - 1,
              lineStart2: line2,
              lineEnd2: line2 + this.minLines - 1,
              linesCount: this.minLines,
              tokensCount: this.countTokens(blocks1.lines.slice(line1 - 1, line1 - 1 + this.minLines).join("\n")),
              similarity,
            });
          }
        }
      }
    }

    return duplicates;
  }

  private computeSimilarity(lines1: string[], lines2: string[]): number {
    const normalized1 = this.normalizeCode(lines1.join("\n"));
    const normalized2 = this.normalizeCode(lines2.join("\n"));

    if (normalized1 === normalized2) return 1.0;

    const tokens1 = normalized1.split(/\s+/);
    const tokens2 = normalized2.split(/\s+/);

    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private countTokens(code: string): number {
    return this.normalizeCode(code).split(/\s+/).length;
  }

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
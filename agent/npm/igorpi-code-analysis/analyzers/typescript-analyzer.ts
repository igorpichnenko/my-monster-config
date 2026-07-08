/**
 * typescript-analyzer.ts — Анализатор TypeScript файлов
 * 
 * v14.7: Исправлена проверка severity с учётом типа Diagnostic
 * - Используются хелперы для надежного определения severity
 * - Hints не попадают в errorState
 */

import { TypeScriptLanguageServer, type Diagnostic } from "../lsp/typescript-lsp.js";
import { errorState } from "../state/error-state.js";
import { readFileSync } from "node:fs";
import { log } from "../lib/logger.js";

// Хелперы для определения severity (обходят ограничения типа Diagnostic)
function isRealError(d: any): boolean {
  const s = d.severity;
  if (typeof s === "string") return s.toLowerCase() === "error";
  if (typeof s === "number") return s === 1;
  return false;
}

export class TypeScriptAnalyzer {
  private lsp: TypeScriptLanguageServer | null = null;
  private initialized = false;
  private projectPath: string;
  private openedFiles = new Set<string>();
  private analysisLock: Promise<void> = Promise.resolve();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.lsp = new TypeScriptLanguageServer(this.projectPath);
    await this.lsp.initialize();
    this.initialized = true;
    log(`✅ TypeScript analyzer initialized`);
  }

  async analyzeFile(filePath: string, content?: string, timeout: number = 180000): Promise<Diagnostic[]> {
    const currentLock = this.analysisLock;
    let releaseLock: () => void;
    this.analysisLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    await currentLock;

    try {
      return await this._analyzeFileInternal(filePath, content, timeout);
    } finally {
      releaseLock!();
    }
  }

  private async _analyzeFileInternal(filePath: string, content?: string, timeout: number = 180000): Promise<Diagnostic[]> {
    log(`🔍 analyzeFile: ${filePath}`);
    
    if (!this.lsp || !this.initialized) {
      log(`⚠️ TypeScript analyzer not initialized`);
      return [];
    }

    try {
      if (!content) {
        content = readFileSync(filePath, "utf-8");
      }

      log(`📖 Reading file (${content.length} chars)`);

      if (!this.openedFiles.has(filePath)) {
        log(`📤 Sending didOpen to LSP...`);
        await this.lsp.didOpen(filePath, content);
        this.openedFiles.add(filePath);
        log(`✅ didOpen sent, file added to openedFiles`);
      } else {
        log(`📤 File already opened, sending didChange...`);
        this.lsp.didChange(filePath, content);
        log(`✅ didChange sent`);
      }

      log(`⏳ Waiting 100ms for LSP to process...`);
      await new Promise(resolve => setTimeout(resolve, 100));

      log(`🔍 Requesting diagnostics (timeout ${timeout}ms)...`);
      const diagnostics = await this.lsp.getDiagnostics(filePath, timeout);
      log(`✅ Received ${diagnostics.length} diagnostics`);

      // v14.7: Используем хелпер для обхода ограничений типа
      const realErrors = diagnostics.filter(isRealError);
      if (realErrors.length > 0) {
        errorState.setFileError(filePath, realErrors.length);
      } else {
        errorState.clearFile(filePath);
      }
      
      return diagnostics;
    } catch (err) {
      log(`❌ Failed to analyze ${filePath}: ${err}`);
      return [];
    }
  }

  async updateFile(filePath: string, content: string, timeout: number = 180000): Promise<Diagnostic[]> {
    const currentLock = this.analysisLock;
    let releaseLock: () => void;
    this.analysisLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    await currentLock;

    try {
      return await this._updateFileInternal(filePath, content, timeout);
    } finally {
      releaseLock!();
    }
  }

  private async _updateFileInternal(filePath: string, content: string, timeout: number = 180000): Promise<Diagnostic[]> {
    log(`🔄 updateFile: ${filePath}`);
    
    if (!this.lsp || !this.initialized) {
      log(`⚠️ TypeScript analyzer not initialized`);
      return [];
    }

    try {
      if (!this.openedFiles.has(filePath)) {
        log(`📤 File NOT in openedFiles, sending didOpen...`);
        await this.lsp.didOpen(filePath, content);
        this.openedFiles.add(filePath);
        log(`✅ didOpen sent`);
      } else {
        log(`📤 File already in openedFiles, sending didChange...`);
        this.lsp.didChange(filePath, content);
        log(`✅ didChange sent`);
      }

      log(`⏳ Waiting 100ms for LSP to process...`);
      await new Promise(resolve => setTimeout(resolve, 100));

      log(`🔍 Requesting diagnostics (timeout ${timeout}ms)...`);
      const diagnostics = await this.lsp.getDiagnostics(filePath, timeout);
      log(`✅ Received ${diagnostics.length} diagnostics`);

      // v14.7: Используем хелпер для обхода ограничений типа
      const realErrors = diagnostics.filter(isRealError);
      if (realErrors.length > 0) {
        errorState.setFileError(filePath, realErrors.length);
      } else {
        errorState.clearFile(filePath);
      }

      return diagnostics;
    } catch (err) {
      log(`❌ Failed to update ${filePath}: ${err}`);
      return [];
    }
  }

  async shutdown(): Promise<void> {
    if (this.lsp) {
      await this.lsp.shutdown();
      this.lsp = null;
      this.initialized = false;
      this.openedFiles.clear();
      log(`TypeScript analyzer shutdown`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

let analyzerInstance: TypeScriptAnalyzer | null = null;

export function getTypeScriptAnalyzer(projectPath: string): TypeScriptAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new TypeScriptAnalyzer(projectPath);
  }
  return analyzerInstance;
}

export function resetTypeScriptAnalyzer(): void {
  analyzerInstance = null;
}
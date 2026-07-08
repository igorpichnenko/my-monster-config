/**
 * cpp-analyzer.ts — Анализатор C++ файлов
 * 
 * Обёртка над CppLanguageServer (clangd).
 */

import { CppLanguageServer, type Diagnostic } from "../lsp/cpp-lsp.js";
import { errorState } from "../state/error-state.js";
import { readFileSync } from "node:fs";
import { log } from "../lib/logger.js";

export class CppAnalyzer {
  private lsp: CppLanguageServer | null = null;
  private initialized = false;
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.lsp = new CppLanguageServer(this.projectPath);
    await this.lsp.initialize();
    this.initialized = true;
    log(`✅ C++ analyzer initialized`);
  }

  async analyzeFile(filePath: string, content?: string): Promise<Diagnostic[]> {
    if (!this.lsp || !this.initialized) {
      console.warn("[igorpi-code-analysis] C++ analyzer not initialized");
      return [];
    }

    try {
      if (!content) {
        content = readFileSync(filePath, "utf-8");
      }

      await this.lsp.didOpen(filePath, content);
      await new Promise(resolve => setTimeout(resolve, 100));

      const diagnostics = await this.lsp.getDiagnostics(filePath);
      errorState.setFileError(filePath, diagnostics.length);

      return diagnostics;
    } catch (err) {
      console.error(`[igorpi-code-analysis] Failed to analyze ${filePath}:`, err);
      return [];
    }
  }

  async updateFile(filePath: string, content: string): Promise<Diagnostic[]> {
    if (!this.lsp || !this.initialized) {
      console.warn("[igorpi-code-analysis] C++ analyzer not initialized");
      return [];
    }

    try {
      this.lsp.didChange(filePath, content);
      await new Promise(resolve => setTimeout(resolve, 100));

      const diagnostics = await this.lsp.getDiagnostics(filePath);
      errorState.setFileError(filePath, diagnostics.length);

      return diagnostics;
    } catch (err) {
      console.error(`[igorpi-code-analysis] Failed to update ${filePath}:`, err);
      return [];
    }
  }

  async shutdown(): Promise<void> {
    if (this.lsp) {
      await this.lsp.shutdown();
      this.lsp = null;
      this.initialized = false;
      log(`C++ analyzer shutdown`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

let analyzerInstance: CppAnalyzer | null = null;

export function getCppAnalyzer(projectPath: string): CppAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new CppAnalyzer(projectPath);
  }
  return analyzerInstance;
}

export function resetCppAnalyzer(): void {
  analyzerInstance = null;
}
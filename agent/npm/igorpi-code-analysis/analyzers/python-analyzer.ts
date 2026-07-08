/**
 * python-analyzer.ts — Анализатор Python файлов
 * 
 * Обёртка над PythonLanguageServer (Pyright).
 */

import { PythonLanguageServer, type Diagnostic } from "../lsp/python-lsp.js";
import { errorState } from "../state/error-state.js";
import { readFileSync } from "node:fs";
import { log } from "../lib/logger.js";

export class PythonAnalyzer {
  private lsp: PythonLanguageServer | null = null;
  private initialized = false;
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.lsp = new PythonLanguageServer(this.projectPath);
    await this.lsp.initialize();
    this.initialized = true;
    log(`✅ Python analyzer initialized`);
  }

  async analyzeFile(filePath: string, content?: string): Promise<Diagnostic[]> {
    if (!this.lsp || !this.initialized) {
      console.warn("[igorpi-code-analysis] Python analyzer not initialized");
      return [];
    }

    try {
      if (!content) {
        content = readFileSync(filePath, "utf-8");
      }

      await this.lsp.didOpen(filePath, content);
      await new Promise(resolve => setTimeout(resolve, 50));

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
      console.warn("[igorpi-code-analysis] Python analyzer not initialized");
      return [];
    }

    try {
      this.lsp.didChange(filePath, content);
      await new Promise(resolve => setTimeout(resolve, 50));

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
      log(`Python analyzer shutdown`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

let analyzerInstance: PythonAnalyzer | null = null;

export function getPythonAnalyzer(projectPath: string): PythonAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new PythonAnalyzer(projectPath);
  }
  return analyzerInstance;
}

export function resetPythonAnalyzer(): void {
  analyzerInstance = null;
}
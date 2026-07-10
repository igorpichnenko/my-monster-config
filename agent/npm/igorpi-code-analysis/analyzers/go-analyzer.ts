/**
 * go-analyzer.ts — Анализатор Go файлов через gopls
 * 
 * v1.0: Базовая поддержка Go через gopls
 */

import { GoLanguageServer, type GoDiagnostic } from "../lsp/go-lsp.js";
import { errorState } from "../state/error-state.js";
import { readFileSync } from "node:fs";
import { log } from "../lib/logger.js";

export class GoAnalyzer {
  private lsp: GoLanguageServer | null = null;
  private initialized = false;
  private projectPath: string;
  private openedFiles = new Set<string>();
  private analysisLock: Promise<void> = Promise.resolve();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.lsp = new GoLanguageServer(this.projectPath);
    await this.lsp.initialize();
    this.initialized = true;
    log(`✅ Go analyzer initialized`);
  }

  async analyzeFile(filePath: string, content?: string, timeout: number = 180000): Promise<GoDiagnostic[]> {
    const currentLock = this.analysisLock;
    let releaseLock: () => void;
    this.analysisLock = new Promise<void>(resolve => { releaseLock = resolve; });
    await currentLock;
    try {
      return await this._analyzeFileInternal(filePath, content, timeout);
    } finally {
      releaseLock!();
    }
  }

  private async _analyzeFileInternal(filePath: string, content?: string, timeout: number = 180000): Promise<GoDiagnostic[]> {
    log(`🔍 analyzeFile: ${filePath}`);
    if (!this.lsp || !this.initialized) return [];

    try {
      if (!content) content = readFileSync(filePath, "utf-8");
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

      const realErrors = diagnostics.filter(d => d.severity === "error");
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

  async updateFile(filePath: string, content: string, timeout: number = 180000): Promise<GoDiagnostic[]> {
    const currentLock = this.analysisLock;
    let releaseLock: () => void;
    this.analysisLock = new Promise<void>(resolve => { releaseLock = resolve; });
    await currentLock;
    try {
      return await this._updateFileInternal(filePath, content, timeout);
    } finally {
      releaseLock!();
    }
  }

  private async _updateFileInternal(filePath: string, content: string, timeout: number = 180000): Promise<GoDiagnostic[]> {
    log(`🔄 updateFile: ${filePath}`);
    if (!this.lsp || !this.initialized) return [];

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

      const realErrors = diagnostics.filter(d => d.severity === "error");
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
      log(`Go analyzer shutdown`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

let analyzerInstance: GoAnalyzer | null = null;

export function getGoAnalyzer(projectPath: string): GoAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new GoAnalyzer(projectPath);
  }
  return analyzerInstance;
}

export function resetGoAnalyzer(): void {
  analyzerInstance = null;
}
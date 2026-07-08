/**
 * python-lsp.ts — Клиент для Pyright Language Server
 * 
 * Использует pyright-langserver (настоящий LSP).
 * Поддерживает стандартный LSP протокол с Content-Length заголовками.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { log } from "../lib/logger.js";

export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source: string;
  ruleId?: string;
  message: string;
  suggestion?: string;
}

export class PythonLanguageServer {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private diagnosticsCallbacks = new Map<string, (diagnostics: Diagnostic[]) => void>();
  private projectPath: string;
  private initialized = false;
  private buffer = "";
  private lspPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.lspPath = this.findLspServer();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.lspPath) {
      throw new Error('Pyright Language Server not found. Install: npm install -g pyright');
    }

    this.process = spawn(this.lspPath, ["--stdio"], {
      cwd: this.projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[igorpi-code-analysis] Pyright stderr: ${text.slice(0, 200)}`);
      }
    });

    this.process.on("exit", (code) => {
      log(`Pyright exited with code ${code}`);
      this.initialized = false;
    });

    await this.sendRequest("initialize", {
      processId: process.pid,
      rootPath: this.projectPath,
      rootUri: `file://${this.projectPath}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
        },
      },
    });

    this.sendNotification("initialized", {});

    this.initialized = true;
    log(`✅ Pyright LSP initialized for ${this.projectPath}`);
  }

  async didChange(filePath: string, content: string): Promise<void> {
    if (!this.initialized) return;

    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri: `file://${filePath}`,
        version: Date.now(),
      },
      contentChanges: [{ text: content }],
    });
  }

  async didOpen(filePath: string, content: string): Promise<void> {
    if (!this.initialized) return;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: "python",
        version: 1,
        text: content,
      },
    });
  }

  async getDiagnostics(filePath: string, timeoutMs: number = 5000): Promise<Diagnostic[]> {
    if (!this.initialized) return [];

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.diagnosticsCallbacks.delete(filePath);
        resolve([]);
      }, timeoutMs);

      this.diagnosticsCallbacks.set(filePath, (diagnostics) => {
        clearTimeout(timeout);
        this.diagnosticsCallbacks.delete(filePath);
        resolve(diagnostics);
      });
    });
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.sendRequest("shutdown", {});
      this.sendNotification("exit", {});
    } catch (err) {
      // Игнорируем
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  // =========================================================================
  // Приватные методы
  // =========================================================================

  private findLspServer(): string {
    const paths = [
      "/home/igorp/.nvm/versions/node/v22.23.0/bin/pyright-langserver",
      "/usr/bin/pyright-langserver",
      "/usr/local/bin/pyright-langserver",
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    return "";
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.sendLspMessage(message);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 10000);
    });
  }

  private sendNotification(method: string, params: any): void {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.sendLspMessage(message);
  }

  private sendLspMessage(obj: any): void {
    const content = JSON.stringify(obj);
    const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
    this.process?.stdin?.write(message);
  }

  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]);
      const contentStart = headerEnd + 4;

      if (this.buffer.length < contentStart + contentLength) break;

      const content = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);

      try {
        const response = JSON.parse(content);
        this.handleMessage(response);
      } catch (err) {
        console.error(`[igorpi-code-analysis] Failed to parse LSP message:`, err);
      }
    }
  }

  private handleMessage(response: any): void {
    if (response.id !== undefined && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id)!;
      this.pendingRequests.delete(response.id);

      if (response.error) {
        reject(new Error(response.error.message || "LSP error"));
      } else {
        resolve(response.result);
      }
    }

    if (response.method === "textDocument/publishDiagnostics") {
      const uri = response.params.uri;
      const filePath = uri.replace("file://", "");
      const diagnostics = this.parseDiagnostics(response.params.diagnostics, filePath);

      const callback = this.diagnosticsCallbacks.get(filePath);
      if (callback) {
        callback(diagnostics);
      }
    }
  }

  private parseDiagnostics(items: any[], filePath: string): Diagnostic[] {
    if (!items) return [];

    return items.map((item) => ({
      filePath,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
      endLine: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
      severity: this.mapSeverity(item.severity),
      source: item.source || "pyright",
      ruleId: item.code,
      message: item.message,
      suggestion: item.message,
    }));
  }

  private mapSeverity(severity: number): 'error' | 'warning' | 'info' | 'hint' {
    switch (severity) {
      case 1: return 'error';
      case 2: return 'warning';
      case 3: return 'info';
      case 4: return 'hint';
      default: return 'warning';
    }
  }
}
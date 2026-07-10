/**
 * go-lsp.ts — Клиент для gopls (Go Language Server)
 * 
 * v1.0: Базовая поддержка Go через gopls
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { log } from "../lib/logger.js";

export interface GoDiagnostic {
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

export class GoLanguageServer {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private diagnosticsCallbacks = new Map<string, (diagnostics: GoDiagnostic[]) => void>();
  private projectPath: string;
  private initialized = false;
  private buffer = "";
  private lspPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.lspPath = this.findGopls();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.lspPath) {
      throw new Error('gopls not found. Install: go install golang.org/x/tools/gopls@latest');
    }

    log(`🚀 Starting gopls: ${this.lspPath}`);
    log(`📁 Project path: ${this.projectPath}`);

    this.process = spawn(this.lspPath, ["serve"], {
      cwd: this.projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log(`⚠️ gopls stderr: ${text.slice(0, 200)}`);
    });

    this.process.on("exit", (code) => {
      log(`🔚 gopls exited with code ${code}`);
      this.initialized = false;
    });

    log(`📤 Sending initialize request...`);
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

    log(`✅ Initialize response received`);
    log(`📤 Sending initialized notification...`);
    this.sendNotification("initialized", {});
    this.initialized = true;
    log(`✅ gopls initialized for ${this.projectPath}`);
  }

  async didOpen(filePath: string, content: string): Promise<void> {
    if (!this.initialized) return;
    log(`📤 Sending didOpen for ${filePath}`);
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: "go",
        version: 1,
        text: content,
      },
    });
    log(`✅ didOpen sent for ${filePath}`);
  }

  didChange(filePath: string, content: string): void {
    if (!this.initialized) return;
    log(`📤 Sending didChange for ${filePath}`);
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: `file://${filePath}`, version: Date.now() },
      contentChanges: [{ text: content }],
    });
    log(`✅ didChange sent for ${filePath}`);
  }

  async getDiagnostics(filePath: string, timeoutMs: number = 180000): Promise<GoDiagnostic[]> {
    if (!this.initialized) return [];

    log(`🔍 getDiagnostics called for ${filePath} (timeout: ${timeoutMs}ms)`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log(`⏰ TIMEOUT: No diagnostics received for ${filePath} after ${timeoutMs}ms`);
        this.diagnosticsCallbacks.delete(filePath);
        resolve([]);
      }, timeoutMs);

      this.diagnosticsCallbacks.set(filePath, (diagnostics) => {
        clearTimeout(timeout);
        this.diagnosticsCallbacks.delete(filePath);
        log(`✅ Callback fired for ${filePath}: ${diagnostics.length} diagnostics`);
        resolve(diagnostics);
      });
    });
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    log(`🛑 Shutting down gopls...`);
    try {
      await this.sendRequest("shutdown", {});
      this.sendNotification("exit", {});
    } catch {}
    this.process.kill();
    this.process = null;
    this.initialized = false;
    log(`✅ gopls shutdown complete`);
  }

  private findGopls(): string {
    const paths = [
      process.env.GOPATH ? `${process.env.GOPATH}/bin/gopls` : "",
      `${process.env.HOME}/go/bin/gopls`,
      "/usr/local/bin/gopls",
      "/usr/bin/gopls",
    ];
    for (const path of paths) {
      if (path && existsSync(path)) return path;
    }
    try {
      const { execSync } = require("node:child_process");
      const result = execSync("which gopls", { encoding: "utf-8" }).trim();
      if (existsSync(result)) return result;
    } catch {}
    return "";
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });
      this.sendLspMessage({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 10000);
    });
  }

  private sendNotification(method: string, params: any): void {
    this.sendLspMessage({ jsonrpc: "2.0", method, params });
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
      if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const contentLength = parseInt(match[1]);
      const contentStart = headerEnd + 4;
      if (this.buffer.length < contentStart + contentLength) break;
      const content = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);
      try {
        this.handleMessage(JSON.parse(content));
      } catch (err) {
        log(`❌ Failed to parse LSP message: ${err}`);
      }
    }
  }

  private handleMessage(response: any): void {
    log(`📨 LSP message: ${response.method || 'response (id:' + response.id + ')'}`);

    if (response.id !== undefined && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id)!;
      this.pendingRequests.delete(response.id);
      if (response.error) {
        log(`❌ LSP error response: ${response.error.message}`);
        reject(new Error(response.error.message || "LSP error"));
      } else {
        log(`✅ LSP response resolved for id: ${response.id}`);
        resolve(response.result);
      }
    }

    if (response.method === "textDocument/publishDiagnostics") {
      const uri = response.params.uri;
      let filePath = uri.replace(/^file:\/\//, "").replace(/\/+$/, "");
      try { filePath = decodeURIComponent(filePath); } catch {}

      const diagnostics = this.parseDiagnostics(response.params.diagnostics, filePath);
      log(`🎯 Received ${diagnostics.length} diagnostics for "${filePath}"`);

      const callback = this.diagnosticsCallbacks.get(filePath);
      if (callback) {
        callback(diagnostics);
      } else {
        log(`⚠️ No callback registered for ${filePath}`);
      }
    }
  }

  private parseDiagnostics(items: any[], filePath: string): GoDiagnostic[] {
    if (!items) return [];
    return items.map((item) => ({
      filePath,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
      endLine: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
      severity: this.mapSeverity(item.severity),
      source: item.source || "gopls",
      ruleId: item.code?.toString() || "",
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
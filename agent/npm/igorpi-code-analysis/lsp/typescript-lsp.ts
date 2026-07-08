/**
 * typescript-language-server.ts — Клиент для TypeScript Language Server
 * 
 * Использует typescript-language-server (настоящий LSP, не tsserver напрямую).
 * Поддерживает стандартный LSP протокол с Content-Length заголовками.
 * 
 * Управляет жизненным циклом:
 * - Запуск и инициализация
 * - Отправка изменений файлов
 * - Получение диагностик (ошибок)
 * 
 * v14.3: Добавлено логирование в файл для отладки
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

export class TypeScriptLanguageServer {
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

  /**
   * Запускает typescript-language-server и инициализирует соединение
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.lspPath) {
      throw new Error('TypeScript Language Server not found. Install: npm install -g typescript-language-server');
    }

    log(`🚀 Starting LSP server: ${this.lspPath}`);
    log(`📁 Project path: ${this.projectPath}`);

    // Запускаем LSP сервер
    this.process = spawn(this.lspPath, ["--stdio"], {
      cwd: this.projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Обрабатываем ответы от сервера
    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        log(`⚠️ LSP stderr: ${text.slice(0, 200)}`);
      }
    });

    this.process.on("exit", (code) => {
      log(`🔚 LSP server exited with code ${code}`);
      this.initialized = false;
    });

    // Отправляем запрос инициализации
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

    // Отправляем initialized notification
    log(`📤 Sending initialized notification...`);
    this.sendNotification("initialized", {});

    this.initialized = true;
    log(`✅ TypeScript LSP initialized for ${this.projectPath}`);
  }

  /**
   * Отправляет изменение файла в LSP сервер
   */
  async didChange(filePath: string, content: string): Promise<void> {
    if (!this.initialized) return;

    log(`📤 Sending didChange for ${filePath}`);
    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri: `file://${filePath}`,
        version: Date.now(),
      },
      contentChanges: [{ text: content }],
    });
    log(`✅ didChange sent for ${filePath}`);
  }

  /**
   * Открывает файл в LSP сервере (для получения диагностик)
   */
  async didOpen(filePath: string, content: string): Promise<void> {
    if (!this.initialized) return;

    log(`📤 Sending didOpen for ${filePath}`);
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: "typescript",
        version: 1,
        text: content,
      },
    });
    log(`✅ didOpen sent for ${filePath}`);
  }

  /**
   * Получает диагностики (ошибки) для файла
   * Ждёт уведомления publishDiagnostics от сервера
   */
  async getDiagnostics(filePath: string, timeoutMs: number = 5000): Promise<Diagnostic[]> {
    if (!this.initialized) return [];

    log(`🔍 getDiagnostics called for ${filePath} (timeout: ${timeoutMs}ms)`);
    log(`   Registered callbacks: ${Array.from(this.diagnosticsCallbacks.keys()).join(', ') || 'none'}`);

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
      
      log(`   Callback registered for ${filePath}`);
    });
  }

  /**
   * Закрывает соединение с LSP сервером
   */
  async shutdown(): Promise<void> {
    if (!this.process) return;

    log(`🛑 Shutting down LSP server...`);
    try {
      await this.sendRequest("shutdown", {});
      this.sendNotification("exit", {});
    } catch (err) {
      // Игнорируем ошибки при закрытии
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
    log(`✅ LSP server shutdown complete`);
  }

  // =========================================================================
  // Приватные методы
  // =========================================================================

  private findLspServer(): string {
    // Ищем typescript-language-server в стандартных местах
    const paths = [
      "/home/igorp/.nvm/versions/node/v22.23.0/bin/typescript-language-server",
      "/usr/bin/typescript-language-server",
      "/usr/local/bin/typescript-language-server",
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    // Пытаемся найти через which
    try {
      const { execSync } = require("node:child_process");
      const result = execSync("which typescript-language-server", { encoding: "utf-8" }).trim();
      if (existsSync(result)) return result;
    } catch {
      // Игнорируем
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

      // Таймаут 10 секунд
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

    // Парсим LSP сообщения (Content-Length заголовки)
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
        log(`❌ Failed to parse LSP message: ${err}`);
      }
    }
  }

  private handleMessage(response: any): void {
    log(`📨 LSP message: ${response.method || 'response (id:' + response.id + ')'}`);
    
    // Если это ответ на запрос
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

    // Если это notification
    if (response.method === "textDocument/publishDiagnostics") {
      const uri = response.params.uri;
      // НОРМАЛИЗАЦИЯ: убираем file:// и trailing slash
      let filePath = uri.replace(/^file:\/\//, "").replace(/\/+$/, "");
      // Декодируем URL-escape (например %20 -> пробел)
      try {
        filePath = decodeURIComponent(filePath);
      } catch {}
      
      const diagnostics = this.parseDiagnostics(response.params.diagnostics, filePath);

      log(`🎯 Received ${diagnostics.length} diagnostics for "${filePath}"`);
      
      for (const d of diagnostics) {
        log(`   ${d.severity}: ${d.message} (line ${d.line})`);
      }

      // Ищем callback — пробуем разные варианты пути
      let callback = this.diagnosticsCallbacks.get(filePath);
      
      if (!callback) {
        // Пробуем найти по basename
        for (const [key, cb] of this.diagnosticsCallbacks.entries()) {
          if (filePath.endsWith(key) || key.endsWith(filePath)) {
            callback = cb;
            log(`✅ Found callback via partial match: registered="${key}", received="${filePath}"`);
            break;
          }
        }
      }

      if (callback) {
        log(`✅ Calling diagnostics callback for ${filePath}`);
        callback(diagnostics);
      } else {
        log(`⚠️ No callback registered for ${filePath}`);
        log(`   Registered callbacks: ${Array.from(this.diagnosticsCallbacks.keys()).map(k => `"${k}"`).join(', ')}`);
      }
    }
  }
   private parseDiagnostics(items: any[], filePath: string): Diagnostic[] {
    if (!items) return [];

    return items.map((item) => ({
      filePath,  // уже нормализованный
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
      endLine: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
      severity: this.mapSeverity(item.severity),
      source: item.source || "typescript",
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

  /**
   * Получает code actions для диагностик
   */
  async getCodeActions(filePath: string, diagnostics: Diagnostic[]): Promise<any[]> {
    if (!this.initialized) return [];

    try {
      const result = await this.sendRequest("textDocument/codeAction", {
        textDocument: { uri: `file://${filePath}` },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 9999, character: 0 },
        },
        context: {
          diagnostics: diagnostics.map(d => ({
            range: {
              start: { line: d.line - 1, character: d.column - 1 },
              end: { line: (d.endLine || d.line) - 1, character: (d.endColumn || d.column) - 1 },
            },
            severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
            message: d.message,
          })),
        },
      });

      return result || [];
    } catch (err) {
      log(`❌ Failed to get code actions: ${err}`);
      return [];
    }
  }
}
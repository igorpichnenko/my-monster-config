/**
 * logger.ts — Простое логирование для igorpi-subagents расширения.
 * 
 * v13: Исправлена критическая ошибка:
 *      - Было: LOG_FILE = join(process.env.HOME) → путь к директории HOME
 *      - appendFileSync на директорию вызывает EISDIR ошибку
 *      - Стало: LOG_FILE = ~/.pi/logs/igorpi-subagents.log
 *      - Добавлено создание директории при необходимости
 *      - Добавлен fallback на /tmp если HOME не определён
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * v13: Путь к лог-файлу — ~/.pi/logs/igorpi-subagents.log
 * 
 * Если HOME не определён — используется /tmp.
 * Директория создаётся автоматически при первом вызове.
 */
function getLogFile(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return join(home, ".pi", "logs", "igorpi-subagents.log");
}

/**
 * v13: Гарантирует существование директории для лога.
 * Создаёт ~/.pi/logs/ если её нет.
 */
function ensureLogDirectory(logFile: string): void {
  const logDir = join(logFile, "..");
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (err) {
      // Если не можем создать директорию — логи пойдут в stderr
      // (обработается в log() через try-catch)
    }
  }
}

export function log(level: "info" | "warn" | "error" | "debug", message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? " " + JSON.stringify(data) : ""}\n`;
  
  const logFile = getLogFile();
  
  // v13: Создаём директорию если нужно
  ensureLogDirectory(logFile);
  
  try {
    appendFileSync(logFile, logLine);
  } catch (err) {
    // Если не можем писать в лог — пишем в stderr
    process.stderr.write(logLine);
  }
  
  // В debug режиме также пишем в stderr
  if (process.env.MCP_DEBUG === "1") {
    process.stderr.write(logLine);
  }
}

export const logger = {
  info: (msg: string, data?: any) => log("info", msg, data),
  warn: (msg: string, data?: any) => log("warn", msg, data),
  error: (msg: string, data?: any) => log("error", msg, data),
  debug: (msg: string, data?: any) => log("debug", msg, data),
};
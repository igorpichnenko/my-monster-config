/**
 * logger.ts — Простое логирование для MCP сервера
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(process.env.HOME);

export function log(level: "info" | "warn" | "error" | "debug", message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? " " + JSON.stringify(data) : ""}\n`;
  
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    // Если не можем писать в лог - пишем в stderr
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
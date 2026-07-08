/**
 * logger.ts — Единый модуль логирования для igorpi-code-analysis
 */

import { appendFileSync } from "node:fs";

let loggingEnabled = false;
const LOG_FILE = "/tmp/igorpi-code-analysis.log";

export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

export function getLoggingEnabled(): boolean {
  return loggingEnabled;
}

export function log(msg: string): void {
  if (!loggingEnabled) return;

  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
  } catch {}

  console.log(`[igorpi-code-analysis] ${msg}`);
}
/**
 * ctx-bash.ts — Инструмент bash с сохранением контекста
 */

import { exec } from "node:child_process";
import { MemoryDatabase } from "../memory/database.js";
import { generateSummary } from "./utils/summary.js";
import { logger } from "./utils/logger.js";

const LARGE_OUTPUT_THRESHOLD = 5000;

export interface CtxBashArgs {
  command: string;
  cwd?: string;
}

export async function executeCtxBash(
  args: CtxBashArgs,
  db: MemoryDatabase
): Promise<string> {
  const { command, cwd = process.cwd() } = args;
  
  logger.info(`Executing bash command: ${command}`, { cwd });
  
  return new Promise((resolve, reject) => {
    exec(command, { cwd, timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        logger.error(`Bash command failed: ${error.message}`);
        reject(new Error(`Command failed: ${error.message}`));
        return;
      }
      
      const output = stdout + (stderr ? `\n${stderr}` : "");
      
      if (output.length < LARGE_OUTPUT_THRESHOLD) {
        logger.info(`Small output (${output.length} chars), returning as is`);
        resolve(output);
        return;
      }
      
      logger.info(`Large output (${output.length} chars), saving to DB`);
      
      try {
        // Передаём команду в контексте для анализатора
        const summary = generateSummary("bash", output, { command });
        const id = db.saveToolOutput({
          toolName: "bash",
          args: JSON.stringify({ command, cwd }),
          output,
          summary,
        });
        
        logger.info(`Saved to DB with ID: ${id}`);
        resolve(`${summary}\n\n💾 Полный вывод сохранён (ID: ${id}). Используй ctx_search для поиска деталей.`);
      } catch (err) {
        logger.error(`Failed to save to DB: ${err}`);
        resolve(`❌ Command executed but output too large to display. Error saving to DB: ${err.message}`);
      }
    });
  });
}
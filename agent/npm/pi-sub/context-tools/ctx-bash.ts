/**
 * ctx-bash.ts — Инструмент bash с сохранением контекста.
 * 
 * Phase 12: Deduplication + Priority System
 * - При повторном вызове с тем же выводом — возвращает существующий ID
 * - Вычисляет приоритет для сортировки в ctx_search
 */

import { exec } from "node:child_process";
import { MemoryDatabase } from "../memory/database.js";
import { generateSummary } from "./utils/summary.js";
import { logger } from "./utils/logger.js";
import { priorityEmoji } from "../memory/utils/priority.js";

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
        // Генерируем summary и сохраняем в БД
        const summary = generateSummary("bash", output, { command });
        const result = db.saveToolOutput({
          toolName: "bash",
          args: JSON.stringify({ command, cwd }),
          output,
          summary,
        });
        
        const emoji = priorityEmoji(result.priority);
        
        if (result.isNew) {
          // Новый вывод — сохраняем
          logger.info(`Saved to DB with ID: ${result.id}, priority: ${result.priority}`);
          resolve(
            `${result.summary}\n\n` +
            `${emoji} Полный вывод сохранён (ID: ${result.id}, priority: ${result.priority}). ` +
            `Используй ctx_search "id:${result.id}" для получения полного вывода или ctx_search "<ключевое слово>" для поиска.`
          );
        } else {
          // Дубликат — используем существующий
          logger.info(`Duplicate detected, reusing ID: ${result.id}, priority: ${result.priority}`);
          resolve(
            `${result.summary}\n\n` +
            `♻️ Вывод уже сохранён (ID: ${result.id}, priority: ${result.priority}). ` +
            `Используй ctx_search "id:${result.id}" для получения полного вывода.`
          );
        }
      } catch (err) {
        logger.error(`Failed to save to DB: ${err}`);
        resolve(`❌ Command executed but output too large to display. Error saving to DB: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });
}
/**
 * ctx-read.ts — Инструмент read с сохранением контекста.
 * 
 * Phase 12: Deduplication + Priority System
 * - При повторном чтении того же файла — возвращает существующий ID
 * - Вычисляет приоритет для сортировки в ctx_search
 */

import { readFile, stat } from "node:fs/promises";
import { MemoryDatabase, priorityEmoji } from "../../igorpi-memory/index.js";
import { generateSummary } from "../utils/summary.js";
import { logger } from "../utils/logger.js";

const LARGE_OUTPUT_THRESHOLD = 5000;

export interface CtxReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export async function executeCtxRead(
  args: CtxReadArgs,
  db: MemoryDatabase
): Promise<string> {
  const { path, offset = 0, limit } = args;
  
  logger.info(`Reading file: ${path} (offset: ${offset}, limit: ${limit || 'all'})`);
  
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${path}`);
    }
    
    const fullContent = await readFile(path, "utf-8");
    const allLines = fullContent.split("\n");
    
    const startLine = Math.max(0, offset);
    const endLine = limit ? Math.min(allLines.length, startLine + limit) : allLines.length;
    const selectedLines = allLines.slice(startLine, endLine);
    const content = selectedLines.join("\n");
    
    if (content.length < LARGE_OUTPUT_THRESHOLD) {
      logger.info(`Small file (${content.length} chars), returning as is`);
      return content;
    }
    
    logger.info(`Large file (${content.length} chars), saving to DB`);
    
    try {
      // Генерируем summary и сохраняем в БД
      const summary = generateSummary("read", content, { path });
      const result = db.saveToolOutput({
        toolName: "read",
        args: JSON.stringify({ path, offset, limit }),
        output: content,
        summary,
      });
      
      const emoji = priorityEmoji(result.priority);
      
      if (result.isNew) {
        // Новый вывод — сохраняем
        logger.info(`Saved to DB with ID: ${result.id}, priority: ${result.priority}`);
        return (
          `${result.summary}\n\n` +
          `${emoji} Полное содержимое файла сохранено (ID: ${result.id}, priority: ${result.priority}). ` +
          `Используй ctx_search "id:${result.id}" для получения полного вывода.`
        );
      } else {
        // Дубликат — используем существующий
        logger.info(`Duplicate detected, reusing ID: ${result.id}, priority: ${result.priority}`);
        return (
          `${result.summary}\n\n` +
          `♻️ Файл уже сохранён (ID: ${result.id}, priority: ${result.priority}). ` +
          `Используй ctx_search "id:${result.id}" для получения полного вывода.`
        );
      }
    } catch (err) {
      logger.error(`Failed to save to DB: ${err}`);
      return content.slice(0, LARGE_OUTPUT_THRESHOLD) + "\n\n[Файл обрезан из-за ошибки сохранения]";
    }
  } catch (err) {
    logger.error(`Failed to read file: ${err}`);
    throw new Error(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
  }
}
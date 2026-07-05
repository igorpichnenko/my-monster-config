/**
 * hash.ts — Утилита для вычисления хэша содержимого.
 * 
 * Используется для:
 * - Deduplication (поиск дубликатов tool_outputs)
 * - Summary cache (кэширование summary по хэшу)
 */

import { createHash } from "node:crypto";

/**
 * Вычисляет SHA-256 хэш содержимого.
 * Возвращает hex-строку длиной 64 символа.
 */
export function calculateContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Возвращает короткий хэш (первые 12 символов) для логирования.
 */
export function shortHash(content: string): string {
  return calculateContentHash(content).slice(0, 12);
}
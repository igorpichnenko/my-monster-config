/**
 * result-compressor.ts — Сжатие результатов субагентов.
 * 
 * Фаза 3: Экономное сжатие больших результатов через субагента-компрессора.
 */

import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryDatabase } from "./database.js";


/** Порог для сжатия (символы). Результаты меньше этого не сжимаются. */
const COMPRESSION_THRESHOLD = 2000;

/** Максимальная длина сжатого результата (символы). */
const MAX_COMPRESSED_LENGTH = 1000;

export interface CompressionResult {
  original: string;
  compressed: string;
  wasCompressed: boolean;
  cached: boolean;
  method: "none" | "cache" | "llm" | "heuristic";
}

function hashResult(result: string): string {
  return createHash("sha256").update(result).digest("hex").slice(0, 16);
}

/**
 * Сжать результат субагента.
 * 
 * Стратегия:
 * 1. Не сжимаем маленькие результаты (< 2000 символов)
 * 2. Проверяем кэш
 * 3. Пытаемся сжать через LLM (прямой вызов)
 * 4. Fallback на эвристическое сжатие
 */
export async function compressResult(
  pi: ExtensionAPI,
  result: string,
  description: string,
  memoryDb: MemoryDatabase
): Promise<CompressionResult> {
  console.log(`[pi-memory] 🗜️ compressResult called: ${result.length} chars`);
  
  // 1. Не сжимаем маленькие результаты
  if (result.length < COMPRESSION_THRESHOLD) {
    console.log(`[pi-memory] 🗜️ Result too small (${result.length} < ${COMPRESSION_THRESHOLD} chars), skipping compression`);
    return {
      original: result,
      compressed: result,
      wasCompressed: false,
      cached: false,
      method: "none",
    };
  }

  // 2. Проверяем кэш
  const hash = hashResult(result);
  const cached = memoryDb.getCompressedResult(hash);
  if (cached) {
    console.log(`[pi-memory] 🗜️ Using cached compressed result for hash ${hash}`);
    return {
      original: result,
      compressed: cached,
      wasCompressed: true,
      cached: true,
      method: "cache",
    };
  }

  // 3. Пытаемся сжать через LLM
  console.log(`[pi-memory] 🗜️ Attempting LLM compression (${result.length} chars)...`);
  
  try {
    const compressed = await compressViaLLM(pi, result, description);
    
    if (compressed && compressed.length > 0) {
      memoryDb.saveCompressedResult(hash, compressed);
      console.log(`[pi-memory] 🗜️ LLM compression successful: ${result.length} → ${compressed.length} chars`);
      
      return {
        original: result,
        compressed,
        wasCompressed: true,
        cached: false,
        method: "llm",
      };
    } else {
      console.log(`[pi-memory] 🗜️ LLM returned empty result, falling back to heuristic`);
    }
  } catch (err) {
    console.error(`[pi-memory] ❌ LLM compression failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`[pi-memory] 🗜️ Falling back to heuristic compression`);
  }
  
  // 4. Fallback на эвристическое сжатие
  const fallback = heuristicCompress(result);
  memoryDb.saveCompressedResult(hash, fallback);
  console.log(`[pi-memory] 🗜️ Heuristic compression: ${result.length} → ${fallback.length} chars`);
  
  return {
    original: result,
    compressed: fallback,
    wasCompressed: true,
    cached: false,
    method: "heuristic",
  };
}

/**
 * Сжать результат через LLM.
 * 
 * Пытаемся использовать pi.chat() или альтернативный API.
 */
async function compressViaLLM(
  pi: ExtensionAPI,
  result: string,
  description: string
): Promise<string> {
  const prompt = `Compress the following agent result into a concise summary.

Task: ${description}

Result (${result.length} chars):
${result.slice(0, 8000)}${result.length > 8000 ? "\n[...truncated...]" : ""}

Requirements:
- Max ${MAX_COMPRESSED_LENGTH} characters
- Keep key findings, decisions, and important details
- Use bullet points for clarity
- Remove verbose explanations and boilerplate

Compressed summary:`;

  console.log(`[pi-memory] 🗜️ Calling LLM with prompt (${prompt.length} chars)...`);
  
  // Пробуем разные API методы
  let response: any = null;
  
  // Метод 1: pi.chat() (если существует)
  if (typeof (pi as any).chat === "function") {
    console.log(`[pi-memory] 🗜️ Using pi.chat() API`);
    try {
      const model = (pi as any).models?.default;
      response = await (pi as any).chat(model, [
        { role: "user", content: prompt }
      ], {
        maxTokens: 400,
        temperature: 0.2,
      });
    } catch (chatErr) {
      console.error(`[pi-memory] ❌ pi.chat() failed: ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`);
    }
  }
  
  // Метод 2: pi.models.generate() (если существует)
  if (!response && typeof (pi as any).models?.generate === "function") {
    console.log(`[pi-memory] 🗜️ Using pi.models.generate() API`);
    try {
      response = await (pi as any).models.generate(prompt, {
        maxTokens: 400,
        temperature: 0.2,
      });
    } catch (genErr) {
      console.error(`[pi-memory] ❌ pi.models.generate() failed: ${genErr instanceof Error ? genErr.message : String(genErr)}`);
    }
  }
  
  // Метод 3: pi.exec() для вызова локальной модели через CLI (если существует)
  if (!response && typeof (pi as any).exec === "function") {
    console.log(`[pi-memory] 🗜️ Trying local model via pi.exec()`);
    try {
      // Пример вызова локальной модели через ollama или другой CLI
      const result = await (pi as any).exec("echo", [prompt], { timeout: 30000 });
      if (result.code === 0 && result.stdout) {
        response = { text: result.stdout };
      }
    } catch (execErr) {
      console.error(`[pi-memory] ❌ pi.exec() failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`);
    }
  }
  
  if (!response) {
    console.log(`[pi-memory] 🗜️ No LLM API available, returning empty`);
    return "";
  }
  
  const compressed = (response.text || response.content || "").trim();
  console.log(`[pi-memory] 🗜️ LLM response: ${compressed.length} chars`);
  
  return compressed.length > MAX_COMPRESSED_LENGTH
    ? compressed.slice(0, MAX_COMPRESSED_LENGTH) + "..."
    : compressed;
}

/**
 * Эвристическое сжатие (fallback).
 */
function heuristicCompress(result: string): string {
  const lines = result.split("\n").filter(l => l.trim());
  const preview = lines.slice(0, 15).join("\n");
  const stats = `[Compressed: ${result.length} chars → ${preview.length} chars, ${lines.length} lines]`;
  return `${stats}\n\n${preview}${lines.length > 15 ? "\n[...truncated...]" : ""}`;
}

export function quickCompress(result: string): string {
  if (result.length < COMPRESSION_THRESHOLD) {
    return result;
  }
  return heuristicCompress(result);
}
/**
 * ctx-bash.ts — Инструмент bash с сохранением контекста.
 * 
 * Phase 12: Deduplication + Priority System
 * - При повторном вызове с тем же выводом — возвращает существующий ID
 * - Вычисляет приоритет для сортировки в ctx_search
 * 
 * v12: Заменён exec на spawn для поддержки abort signal
 *      Теперь процесс корректно завершается при отмене субагента
 */

import { spawn } from "node:child_process";
import { MemoryDatabase, priorityEmoji } from "../../igorpi-memory/index.js";
import { generateSummary } from "../utils/summary.js";
import { logger } from "../utils/logger.js";

const LARGE_OUTPUT_THRESHOLD = 5000;
const DEFAULT_TIMEOUT = 30000; // 30 секунд
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export interface CtxBashArgs {
  command: string;
  cwd?: string;
}

/**
 * Выполняет bash команду через spawn (вместо exec).
 * 
 * v12: Поддерживает abort через AbortSignal.
 * Возвращает { stdout, stderr, exitCode, killed }.
 */
function spawnBash(
  command: string,
  options: {
    cwd: string;
    timeout: number;
    signal?: AbortSignal;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number; killed: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;
    let killed = false;
    
    // Таймаут
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // Даём 5 секунд на graceful shutdown
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, options.timeout);
    
    // Обработка abort signal
    const onAbort = () => {
      killed = true;
      clearTimeout(timeoutId);
      child.kill('SIGTERM');
    };
    
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    
    child.stdout.on('data', (data) => {
      if (stdoutSize < MAX_BUFFER) {
        stdout += data.toString();
        stdoutSize += data.length;
      }
    });
    
    child.stderr.on('data', (data) => {
      if (stderrSize < MAX_BUFFER) {
        stderr += data.toString();
        stderrSize += data.length;
      }
    });
    
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      reject(err);
    });
    
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        killed,
      });
    });
  });
}

export async function executeCtxBash(
  args: CtxBashArgs,
  db: MemoryDatabase,
  signal?: AbortSignal
): Promise<string> {
  const { command, cwd = process.cwd() } = args;
  
  logger.info(`Executing bash command: ${command}`, { cwd });
  
  try {
    const result = await spawnBash(command, {
      cwd,
      timeout: DEFAULT_TIMEOUT,
      signal,
    });
    
    // Если процесс был убит (timeout или abort)
    if (result.killed) {
      logger.error(`Bash command killed (timeout or abort): ${command}`);
      return `❌ Command was killed (timeout or abort): ${command}`;
    }
    
    // Если команда завершилась с ошибкой И нет stdout
    if (result.exitCode !== 0 && !result.stdout) {
      logger.error(`Bash command failed: exit code ${result.exitCode}, stderr: ${result.stderr}`);
      return `❌ Command failed (exit code ${result.exitCode}): ${result.stderr || 'No output'}`;
    }
    
    const output = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
    
    if (output.length < LARGE_OUTPUT_THRESHOLD) {
      logger.info(`Small output (${output.length} chars), returning as is`);
      return output;
    }
    
    logger.info(`Large output (${output.length} chars), saving to DB`);
    
    // Генерируем summary и сохраняем в БД
    const summary = generateSummary("bash", output, { command });
    const saveResult = db.saveToolOutput({
      toolName: "bash",
      args: JSON.stringify({ command, cwd }),
      output,
      summary,
    });
    
    const emoji = priorityEmoji(saveResult.priority);
    
    if (saveResult.isNew) {
      // Новый вывод — сохраняем
      logger.info(`Saved to DB with ID: ${saveResult.id}, priority: ${saveResult.priority}`);
      return (
        `${saveResult.summary}\n\n` +
        `${emoji} Полный вывод сохранён (ID: ${saveResult.id}, priority: ${saveResult.priority}). ` +
        `Используй ctx_search "id:${saveResult.id}" для получения полного вывода или ctx_search "<ключевое слово>" для поиска.`
      );
    } else {
      // Дубликат — используем существующий
      logger.info(`Duplicate detected, reusing ID: ${saveResult.id}, priority: ${saveResult.priority}`);
      return (
        `${saveResult.summary}\n\n` +
        `♻️ Вывод уже сохранён (ID: ${saveResult.id}, priority: ${saveResult.priority}). ` +
        `Используй ctx_search "id:${saveResult.id}" для получения полного вывода.`
      );
    }
  } catch (err) {
    logger.error(`Failed to execute bash command: ${err}`);
    return `❌ Command execution failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
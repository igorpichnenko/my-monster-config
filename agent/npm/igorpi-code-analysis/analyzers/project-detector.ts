/**
 * project-detector.ts — Определение типа проекта
 * 
 * Анализирует корневую директорию проекта и определяет:
 * - TypeScript/JavaScript (tsconfig.json, package.json)
 * - Python (pyproject.toml, requirements.txt, setup.py)
 * - C++ (CMakeLists.txt, .clangd)
 * - Go (go.mod)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type ProjectType = "typescript" | "python" | "cpp" | "go" | "unknown";

/**
 * Определяет тип проекта по наличию конфигурационных файлов
 */
export function detectProjectType(projectPath: string): ProjectType {
  // Go (проверяем первым — go.mod является definitive признаком Go-проекта)
  if (existsSync(join(projectPath, "go.mod"))) {
    return "go";
  }

  // TypeScript/JavaScript
  if (
    existsSync(join(projectPath, "tsconfig.json")) ||
    existsSync(join(projectPath, "package.json"))
  ) {
    return "typescript";
  }

  // Python
  if (
    existsSync(join(projectPath, "pyproject.toml")) ||
    existsSync(join(projectPath, "requirements.txt")) ||
    existsSync(join(projectPath, "setup.py")) ||
    existsSync(join(projectPath, "Pipfile"))
  ) {
    return "python";
  }

  // C++
  if (
    existsSync(join(projectPath, "CMakeLists.txt")) ||
    existsSync(join(projectPath, ".clangd")) ||
    existsSync(join(projectPath, "compile_commands.json"))
  ) {
    return "cpp";
  }

  return "unknown";
}

/**
 * Проверяет, поддерживается ли файл для анализа
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return false;

  const supportedExtensions = [
    "ts", "tsx", "js", "jsx",           // TypeScript/JavaScript
    "py", "pyi",                         // Python
    "cpp", "c", "cc", "cxx", "h", "hpp", // C++
    "go",                                // Go
  ];

  return supportedExtensions.includes(ext);
}

/**
 * Возвращает язык для LSP на основе расширения файла
 */
export function getLanguageForFile(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "plaintext";

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    py: "python",
    pyi: "python",
    cpp: "cpp",
    c: "c",
    cc: "cpp",
    cxx: "cpp",
    h: "cpp",
    hpp: "cpp",
    go: "go",
  };

  return languageMap[ext] || "plaintext";
}
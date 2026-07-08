/**
 * auto-fixer.ts — Автоисправление через внешние инструменты
 * 
 * Использует:
 * - ESLint --fix для JavaScript/TypeScript (с конфигом)
 * - Biome --write --unsafe для JavaScript/TypeScript (fallback)
 * - Ruff --fix для Python
 * - clang-tidy --fix для C++
 * 
 * Config-first подход как в pi-lens.
 * 
 * v17.2: Добавлен флаг --unsafe для Biome (применяет все исправления)
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../lib/logger.js";

export interface AutoFixResult {
  tool: string;
  fixed: boolean;
  message: string;
  exitCode: number | null;
}

export class AutoFixer {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  async fixFile(filePath: string): Promise<AutoFixResult> {
    const ext = filePath.split(".").pop()?.toLowerCase();

    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      return this.fixJavaScriptFile(filePath);
    }

    if (ext === "py" || ext === "pyi") {
      return this.fixPythonFile(filePath);
    }

    if (ext === "cpp" || ext === "c" || ext === "cc" || ext === "cxx" || ext === "h" || ext === "hpp") {
      return this.fixCppFile(filePath);
    }

    return {
      tool: "none",
      fixed: false,
      message: `No auto-fix tool available for .${ext} files`,
      exitCode: null,
    };
  }

  // =========================================================================
  // JavaScript/TypeScript
  // =========================================================================

  private async fixJavaScriptFile(filePath: string): Promise<AutoFixResult> {
    const hasEslintConfig = this.hasEslintConfig();
    
    if (hasEslintConfig) {
      log(`🔧 Found ESLint config, using ESLint`);
      return this.fixWithEslint(filePath);
    }

    const hasBiomeConfig = this.hasBiomeConfig();
    
    if (hasBiomeConfig) {
      log(`🔧 Found Biome config, using Biome`);
      return this.fixWithBiome(filePath);
    }

    const biomePath = this.findBiome();
    if (biomePath) {
      log(`🔧 No config found, using Biome as smart-default`);
      return this.fixWithBiome(filePath);
    }

    return {
      tool: "none",
      fixed: false,
      message: "No auto-fix tool available. Install ESLint with config or Biome.",
      exitCode: null,
    };
  }

  private hasEslintConfig(): boolean {
    const configFiles = [
      ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml",
      ".eslintrc.json", ".eslintrc", "eslint.config.js", "eslint.config.mjs",
      "eslint.config.cjs",
    ];

    for (const file of configFiles) {
      if (existsSync(join(this.projectPath, file))) return true;
    }

    const packageJsonPath = join(this.projectPath, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (packageJson.eslintConfig) return true;
      } catch {}
    }

    return false;
  }

  private hasBiomeConfig(): boolean {
    return existsSync(join(this.projectPath, "biome.json")) ||
           existsSync(join(this.projectPath, "biome.jsonc"));
  }

  private fixWithEslint(filePath: string): Promise<AutoFixResult> {
    return this.runTool("eslint", this.findEslint(), ["--fix", filePath], filePath);
  }

  private fixWithBiome(filePath: string): Promise<AutoFixResult> {
    // v17.2: Добавлен флаг --unsafe для применения всех исправлений
    return this.runTool("biome", this.findBiome(), ["check", "--write", "--unsafe", filePath], filePath);
  }

  private findEslint(): string | null {
    const localPath = join(this.projectPath, "node_modules", ".bin", "eslint");
    if (existsSync(localPath)) return localPath;

    const globalPaths = [
      "/home/igorp/.nvm/versions/node/v22.23.0/bin/eslint",
      "/usr/bin/eslint", "/usr/local/bin/eslint",
    ];

    for (const path of globalPaths) {
      if (existsSync(path)) return path;
    }

    return null;
  }

  private findBiome(): string | null {
    const localPath = join(this.projectPath, "node_modules", ".bin", "biome");
    if (existsSync(localPath)) return localPath;

    const globalPaths = [
      "/home/igorp/.nvm/versions/node/v22.23.0/bin/biome",
      "/usr/bin/biome", "/usr/local/bin/biome",
    ];

    for (const path of globalPaths) {
      if (existsSync(path)) return path;
    }

    return null;
  }

  // =========================================================================
  // Python
  // =========================================================================

  private async fixPythonFile(filePath: string): Promise<AutoFixResult> {
    const ruffPath = this.findRuff();
    
    if (ruffPath) {
      log(`🔧 Using Ruff for Python`);
      return this.fixWithRuff(filePath);
    }

    return {
      tool: "none",
      fixed: false,
      message: "Ruff not found. Install: pipx install ruff",
      exitCode: null,
    };
  }

  private fixWithRuff(filePath: string): Promise<AutoFixResult> {
    return this.runTool("ruff", this.findRuff(), ["check", "--fix", filePath], filePath);
  }

  private findRuff(): string | null {
    const paths = [
      "/home/igorp/.local/bin/ruff",
      "/usr/bin/ruff",
      "/usr/local/bin/ruff",
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    return null;
  }

  // =========================================================================
  // C++
  // =========================================================================

  private async fixCppFile(filePath: string): Promise<AutoFixResult> {
    const clangTidyPath = this.findClangTidy();
    
    if (clangTidyPath) {
      log(`🔧 Using clang-tidy for C++`);
      return this.fixWithClangTidy(filePath);
    }

    return {
      tool: "none",
      fixed: false,
      message: "clang-tidy not found. Install: sudo apt install clang-tidy",
      exitCode: null,
    };
  }

  private fixWithClangTidy(filePath: string): Promise<AutoFixResult> {
    return this.runTool("clang-tidy", this.findClangTidy(), ["-fix", filePath], filePath);
  }

  private findClangTidy(): string | null {
    const paths = [
      "/usr/bin/clang-tidy",
      "/usr/local/bin/clang-tidy",
    ];

    for (const path of paths) {
      if (existsSync(path)) return path;
    }

    return null;
  }

  // =========================================================================
  // Общий запуск инструментов
  // =========================================================================

  private runTool(toolName: string, toolPath: string | null, args: string[], filePath?: string): Promise<AutoFixResult> {
    return new Promise((resolve) => {
      if (!toolPath) {
        resolve({
          tool: toolName,
          fixed: false,
          message: `${toolName} not found`,
          exitCode: null,
        });
        return;
      }

      log(`🔧 Running ${toolName} ${args.join(" ")}`);

      // Читаем содержимое файла ДО исправления
      let beforeContent = "";
      if (filePath) {
        try {
          beforeContent = readFileSync(filePath, "utf-8");
        } catch {}
      }

      const proc = spawn(toolPath, args, {
        cwd: this.projectPath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        // Проверяем изменился ли файл
        let fileChanged = false;
        if (filePath) {
          try {
            const afterContent = readFileSync(filePath, "utf-8");
            fileChanged = beforeContent !== afterContent;
          } catch {}
        }

        // Для Ruff/clang-tidy exit code 1 — нормально (остались неисправимые ошибки)
        // Важно: изменился ли файл?
        const fixed = code === 0 || fileChanged;
        
        let message: string;
        if (code === 0) {
          message = `✅ ${toolName} fixed successfully`;
        } else if (fileChanged) {
          message = `⚠️ ${toolName} partially fixed (some errors remain)`;
        } else {
          message = `⚠️ ${toolName} finished with code ${code}: ${stderr.slice(0, 200)}`;
        }

        log(message);

        resolve({
          tool: toolName,
          fixed,
          message,
          exitCode: code,
        });
      });

      proc.on("error", (err) => {
        resolve({
          tool: toolName,
          fixed: false,
          message: `Failed to run ${toolName}: ${err.message}`,
          exitCode: null,
        });
      });
    });
  }
}
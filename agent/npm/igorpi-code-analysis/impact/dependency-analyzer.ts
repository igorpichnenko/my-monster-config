/**
 * dependency-analyzer.ts — Анализ зависимостей между файлами
 * 
 * Использует tree-sitter для точного парсинга AST.
 * Поддерживает:
 * - TypeScript/JavaScript (tree-sitter-typescript)
 * - Python (tree-sitter-python)
 * - C++ (tree-sitter-cpp)
 * 
 * v5: Добавлены инкрементальные методы для анализа при edit/write
 */

import { TreeSitterAnalyzer } from "./tree-sitter-analyzer.js";
import { getTreeSitterCache } from "./tree-sitter-cache.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { MemoryDatabase } from "../../igorpi-memory/index.js";
import { log } from "../lib/logger.js";

export interface Dependency {
  filePath: string;
  dependsOn: string;
  dependencyType: "import" | "require" | "dynamic";
  isCircular: boolean;
}

export interface ImpactResult {
  impactedFiles: string[];
  depth: number;
  circularDependencies: string[];
}

export class DependencyAnalyzer {
  private projectPath: string;
  private memoryDb: MemoryDatabase;
  private dependencyGraph = new Map<string, Set<string>>();
  private reverseGraph = new Map<string, Set<string>>();
  private cache = getTreeSitterCache();

  constructor(projectPath: string, memoryDb: MemoryDatabase) {
    this.projectPath = projectPath;
    this.memoryDb = memoryDb;
  }

  /**
   * v5: Инкрементальный анализ одного файла
   * Используется при edit/write для обновления зависимостей
   */
  async analyzeFileIncremental(filePath: string): Promise<{
    dependencies: Dependency[];
    impactedFiles: string[];
  }> {
    if (!existsSync(filePath)) {
      return { dependencies: [], impactedFiles: [] };
    }

    const ext = filePath.split(".").pop()?.toLowerCase();
    let language: "typescript" | "python" | "cpp" | null = null;

    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      language = "typescript";
    } else if (ext === "py" || ext === "pyi") {
      language = "python";
    } else if (ext === "cpp" || ext === "c" || ext === "h" || ext === "hpp") {
      language = "cpp";
    }

    if (!language) {
      return { dependencies: [], impactedFiles: [] };
    }

    try {
      // v5: Удаляем старые зависимости для этого файла
      this.memoryDb.deleteDependenciesByFile(this.projectPath, filePath);
      
      // v5: Получаем анализ файла из кэша (или парсим заново)
      const analysis = this.cache.getAnalysis(filePath, language);
      
      const dependencies: Dependency[] = [];

      for (const imp of analysis.imports) {
        if (imp.path.startsWith("node:")) {
          continue;
        }

        const resolvedPath = this.resolveImport(imp.path, filePath);
        
        if (!resolvedPath) {
          continue;
        }

        const dependency: Dependency = {
          filePath,
          dependsOn: resolvedPath,
          dependencyType: imp.type === "export" ? "import" : imp.type,
          isCircular: false,
        };

        dependencies.push(dependency);

        // Обновляем графы в памяти
        if (!this.dependencyGraph.has(filePath)) {
          this.dependencyGraph.set(filePath, new Set());
        }
        this.dependencyGraph.get(filePath)!.add(resolvedPath);

        if (!this.reverseGraph.has(resolvedPath)) {
          this.reverseGraph.set(resolvedPath, new Set());
        }
        this.reverseGraph.get(resolvedPath)!.add(filePath);

        // Сохраняем в БД
        this.memoryDb.saveDependency({
          projectPath: this.projectPath,
          filePath,
          dependsOn: resolvedPath,
          dependencyType: dependency.dependencyType,
          sessionId: "current",
        });
      }

      // v5: Проверяем какие файлы зависят от изменённого файла
      const impactedFiles = this.getDependents(filePath);

      return { dependencies, impactedFiles };
    } catch (err) {
      log(`❌ Failed to analyze ${filePath} incrementally: ${err}`);
      return { dependencies: [], impactedFiles: [] };
    }
  }

  /**
   * v5: Проверяет влияние файла на другие файлы
   */
  checkImpact(filePath: string): string[] {
    return this.getDependents(filePath);
  }

  /**
   * Анализирует файл и извлекает зависимости через tree-sitter (с кэшем)
   */
  async analyzeFile(filePath: string): Promise<Dependency[]> {
    if (!existsSync(filePath)) {
      return [];
    }

    const ext = filePath.split(".").pop()?.toLowerCase();
    let language: "typescript" | "python" | "cpp" | null = null;

    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      language = "typescript";
    } else if (ext === "py" || ext === "pyi") {
      language = "python";
    } else if (ext === "cpp" || ext === "c" || ext === "h" || ext === "hpp") {
      language = "cpp";
    }

    if (!language) {
      return [];
    }

    try {
      const analysis = this.cache.getAnalysis(filePath, language);
      
      const dependencies: Dependency[] = [];

      for (const imp of analysis.imports) {
        if (imp.path.startsWith("node:")) {
          continue;
        }

        const resolvedPath = this.resolveImport(imp.path, filePath);
        
        if (!resolvedPath) {
          continue;
        }

        const dependency: Dependency = {
          filePath,
          dependsOn: resolvedPath,
          dependencyType: imp.type === "export" ? "import" : imp.type,
          isCircular: false,
        };

        dependencies.push(dependency);

        if (!this.dependencyGraph.has(filePath)) {
          this.dependencyGraph.set(filePath, new Set());
        }
        this.dependencyGraph.get(filePath)!.add(resolvedPath);

        if (!this.reverseGraph.has(resolvedPath)) {
          this.reverseGraph.set(resolvedPath, new Set());
        }
        this.reverseGraph.get(resolvedPath)!.add(filePath);

        this.memoryDb.saveDependency({
          projectPath: this.projectPath,
          filePath,
          dependsOn: resolvedPath,
          dependencyType: dependency.dependencyType,
          sessionId: "current",
        });
      }

      const circularDeps = this.detectCircularDependencies();
      for (const dep of dependencies) {
        dep.isCircular = circularDeps.includes(dep.filePath);
      }

      return dependencies;
    } catch (err) {
      console.error(`[igorpi-code-analysis] ❌ Failed to analyze ${filePath}:`, err);
      return [];
    }
  }

  /**
   * Анализирует все файлы в проекте (рекурсивно)
   */
  async analyzeProject(): Promise<void> {
    log(`🔍 Analyzing project dependencies with tree-sitter...`);
    log(`📁 Project path: ${this.projectPath}`);

    const deleted = this.memoryDb.deleteDependenciesByProject(this.projectPath);
    log(`🗑️ Cleared ${deleted} old dependencies`);

    this.dependencyGraph.clear();
    this.reverseGraph.clear();

    const files = this.getAllFiles(this.projectPath);
    log(`📂 Found ${files.length} files to analyze`);

    if (files.length === 0) {
      log(`⚠️ No files found!`);
      return;
    }

    for (const file of files) {
      await this.analyzeFile(file);
    }

    const stats = this.cache.getStats();
    log(`✅ Analyzed ${files.length} files`);
    log(`📊 Dependency graph size: ${this.dependencyGraph.size} files`);
    log(`📊 Total dependencies: ${Array.from(this.dependencyGraph.values()).reduce((sum, set) => sum + set.size, 0)}`);
    log(`📊 Cache: ${stats.analysisSize} files, ${stats.hits} hits, ${stats.misses} misses, ${Math.round(stats.hitRate * 100)}% hit rate`);
  }

  private getAllFiles(dir: string, files: string[] = []): string[] {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (["node_modules", "dist", "build", ".git", ".pi"].includes(entry)) {
          continue;
        }
        this.getAllFiles(fullPath, files);
      } else {
        if (/\.(ts|tsx|js|jsx|py|pyi|cpp|c|h|hpp)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    }
    
    return files;
  }

  getImpact(filePath: string, maxDepth: number = 3): ImpactResult {
    const impactedFiles = new Set<string>();
    const queue: Array<{ file: string; depth: number }> = [{ file: filePath, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;

      if (visited.has(file) || depth > maxDepth) continue;
      visited.add(file);

      const dependents = this.reverseGraph.get(file);
      if (!dependents) continue;

      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          impactedFiles.add(dependent);
          queue.push({ file: dependent, depth: depth + 1 });
        }
      }
    }

    const circularDeps = this.detectCircularDependencies();

    return {
      impactedFiles: Array.from(impactedFiles),
      depth: maxDepth,
      circularDependencies: circularDeps,
    };
  }

  getDependencies(filePath: string): string[] {
    const deps = this.dependencyGraph.get(filePath);
    return deps ? Array.from(deps) : [];
  }

  getDependents(filePath: string): string[] {
    const dependents = this.reverseGraph.get(filePath);
    return dependents ? Array.from(dependents) : [];
  }

  detectCircularDependencies(): string[] {
    const circular = new Set<string>();
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const file of this.dependencyGraph.keys()) {
      if (!visited.has(file)) {
        this.detectCycleDFS(file, visited, recursionStack, circular);
      }
    }

    return Array.from(circular);
  }

  private detectCycleDFS(
    node: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    circular: Set<string>
  ): boolean {
    visited.add(node);
    recursionStack.add(node);

    const dependencies = this.dependencyGraph.get(node);
    if (dependencies) {
      for (const dep of dependencies) {
        if (!visited.has(dep)) {
          if (this.detectCycleDFS(dep, visited, recursionStack, circular)) {
            circular.add(node);
            return true;
          }
        } else if (recursionStack.has(dep)) {
          circular.add(node);
          circular.add(dep);
          return true;
        }
      }
    }

    recursionStack.delete(node);
    return false;
  }

  private resolveImport(importPath: string, fromFile: string): string | null {
    if (importPath.startsWith("node:")) {
      return null;
    }

    if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
      return null;
    }

    const fromDir = dirname(fromFile);
    
    let cleanPath = importPath;
    if (cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs") || cleanPath.endsWith(".cjs")) {
      cleanPath = cleanPath.replace(/\.(js|mjs|cjs)$/, "");
    }
    
    let resolvedPath = resolve(fromDir, cleanPath);

    const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
    
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }

    for (const ext of extensions) {
      const withExt = resolvedPath + ext;
      if (existsSync(withExt)) {
        return withExt;
      }
    }

    for (const ext of extensions) {
      const indexPath = join(resolvedPath, `index${ext}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }
}
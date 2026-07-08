/**
 * tree-sitter-analyzer.ts — Парсинг кода через tree-sitter
 * 
 * Поддерживает:
 * - TypeScript/JavaScript (tree-sitter-typescript)
 * - Python (tree-sitter-python)
 * - C++ (tree-sitter-cpp)
 * 
 * Извлекает:
 * - Импорты (import/export)
 * - Функции (function/class/method)
 * - Переменные (variable/const/let)
 * - Зависимости между файлами
 */

import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Cpp from "tree-sitter-cpp";
import { readFileSync } from "node:fs";

export interface ImportInfo {
  path: string;
  line: number;
  type: "import" | "export" | "require";
}

export interface SymbolInfo {
  name: string;
  type: "function" | "class" | "variable" | "interface" | "type" | "method";
  line: number;
  exported: boolean;
}

export interface TreeSitterAnalysis {
  imports: ImportInfo[];
  symbols: SymbolInfo[];
  exports: string[];
}

export class TreeSitterAnalyzer {
  private parser: Parser;
  private language: string;

  constructor(language: "typescript" | "python" | "cpp") {
    this.parser = new Parser();
    this.language = language;

    switch (language) {
      case "typescript":
        this.parser.setLanguage(TypeScript.typescript as any);
        break;
      case "python":
        this.parser.setLanguage(Python as any);
        break;
      case "cpp":
        this.parser.setLanguage(Cpp as any);
        break;
    }
  }

  /**
   * Анализирует файл и извлекает импорты, символы, экспорты
   */
  analyzeFile(filePath: string): TreeSitterAnalysis {
    const content = readFileSync(filePath, "utf-8");
    const tree = this.parser.parse(content);

    return {
      imports: this.extractImports(tree.rootNode, content),
      symbols: this.extractSymbols(tree.rootNode, content),
      exports: this.extractExports(tree.rootNode, content),
    };
  }

  /**
   * Извлекает импорты из AST
   */
  private extractImports(rootNode: Parser.SyntaxNode, _content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];

    if (this.language === "typescript") {
      this.extractTypeScriptImports(rootNode, imports);
    } else if (this.language === "python") {
      this.extractPythonImports(rootNode, imports);
    } else if (this.language === "cpp") {
      this.extractCppImports(rootNode, imports);
    }

    return imports;
  }

  private extractTypeScriptImports(node: Parser.SyntaxNode, imports: ImportInfo[]) {
    // import ... from '...'
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const path = sourceNode.text.replace(/['"]/g, "");
        imports.push({
          path,
          line: node.startPosition.row + 1,
          type: "import",
        });
      }
    }

    // export ... from '...'
    if (node.type === "export_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const path = sourceNode.text.replace(/['"]/g, "");
        imports.push({
          path,
          line: node.startPosition.row + 1,
          type: "export",
        });
      }
    }

    // require('...')
   if (node.type === "call_expression") {
  const funcNode = node.childForFieldName("function");
  if (funcNode?.text === "require") {
    const argsNode = node.childForFieldName("arguments");
    if (argsNode && argsNode.children.length > 0) {
      const argNode = argsNode.children[0];
      // v3: Проверяем что это строковый литерал
      if (argNode.type === "string" || argNode.type === "string_fragment") {
        const path = argNode.text.replace(/['"]/g, "");
        // v3: Игнорируем пустые или невалидные пути
        if (path && path.length > 0 && !path.startsWith("(")) {
          imports.push({
            path,
            line: node.startPosition.row + 1,
            type: "require",
          });
        }
      }
    }
  }
}

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractTypeScriptImports(child, imports);
    }
  }

  private extractPythonImports(node: Parser.SyntaxNode, imports: ImportInfo[]) {
    // import ...
    if (node.type === "import_statement") {
      for (const child of node.children) {
        if (child.type === "dotted_name" || child.type === "aliased_import") {
          const path = child.type === "aliased_import" 
            ? child.children[0].text 
            : child.text;
          imports.push({
            path,
            line: node.startPosition.row + 1,
            type: "import",
          });
        }
      }
    }

    // from ... import ...
    if (node.type === "import_from_statement") {
      const moduleName = node.childForFieldName("module_name");
      if (moduleName) {
        imports.push({
          path: moduleName.text,
          line: node.startPosition.row + 1,
          type: "import",
        });
      }
    }

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractPythonImports(child, imports);
    }
  }

  private extractCppImports(node: Parser.SyntaxNode, imports: ImportInfo[]) {
    // #include "..."
    if (node.type === "preproc_include") {
      const pathNode = node.children.find(c => c.type === "string_literal" || c.type === "system_lib_string");
      if (pathNode) {
        const path = pathNode.text.replace(/[<>"']/g, "");
        imports.push({
          path,
          line: node.startPosition.row + 1,
          type: "import",
        });
      }
    }

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractCppImports(child, imports);
    }
  }

  /**
   * Извлекает символы (функции, классы, переменные) из AST
   */
  private extractSymbols(rootNode: Parser.SyntaxNode, _content: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    if (this.language === "typescript") {
      this.extractTypeScriptSymbols(rootNode, symbols);
    } else if (this.language === "python") {
      this.extractPythonSymbols(rootNode, symbols);
    } else if (this.language === "cpp") {
      this.extractCppSymbols(rootNode, symbols);
    }

    return symbols;
  }

  private extractTypeScriptSymbols(node: Parser.SyntaxNode, symbols: SymbolInfo[]) {
    // function declaration
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const isExported = node.parent?.type === "export_statement";
        symbols.push({
          name: nameNode.text,
          type: "function",
          line: node.startPosition.row + 1,
          exported: isExported,
        });
      }
    }

    // class declaration
    if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const isExported = node.parent?.type === "export_statement";
        symbols.push({
          name: nameNode.text,
          type: "class",
          line: node.startPosition.row + 1,
          exported: isExported,
        });
      }
    }

    // variable declaration
    if (node.type === "variable_declaration") {
      const declarator = node.children.find(c => c.type === "variable_declarator");
      if (declarator) {
        const nameNode = declarator.childForFieldName("name");
        if (nameNode) {
          const isExported = node.parent?.type === "export_statement";
          symbols.push({
            name: nameNode.text,
            type: "variable",
            line: node.startPosition.row + 1,
            exported: isExported,
          });
        }
      }
    }

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractTypeScriptSymbols(child, symbols);
    }
  }

  private extractPythonSymbols(node: Parser.SyntaxNode, symbols: SymbolInfo[]) {
    // function definition
    if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: "function",
          line: node.startPosition.row + 1,
          exported: true, // Python: всё экспортируется по умолчанию
        });
      }
    }

    // class definition
    if (node.type === "class_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: "class",
          line: node.startPosition.row + 1,
          exported: true,
        });
      }
    }

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractPythonSymbols(child, symbols);
    }
  }

  private extractCppSymbols(node: Parser.SyntaxNode, symbols: SymbolInfo[]) {
    // function definition
    if (node.type === "function_definition") {
      const declarator = node.childForFieldName("declarator");
      if (declarator) {
        const nameNode = declarator.children.find(c => c.type === "function_declarator");
        if (nameNode) {
          const decl = nameNode.childForFieldName("declarator");
          if (decl) {
            symbols.push({
              name: decl.text,
              type: "function",
              line: node.startPosition.row + 1,
              exported: true,
            });
          }
        }
      }
    }

    // class definition
    if (node.type === "class_specifier") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: "class",
          line: node.startPosition.row + 1,
          exported: true,
        });
      }
    }

    // Рекурсивно обходим детей
    for (const child of node.children) {
      this.extractCppSymbols(child, symbols);
    }
  }

  /**
   * Извлекает экспортируемые символы
   */
  private extractExports(rootNode: Parser.SyntaxNode, content: string): string[] {
    const exports: string[] = [];
    const symbols = this.extractSymbols(rootNode, content);
    
    for (const symbol of symbols) {
      if (symbol.exported) {
        exports.push(symbol.name);
      }
    }

    return exports;
  }
}
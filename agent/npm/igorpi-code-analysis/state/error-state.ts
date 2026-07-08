/**
 * error-state.ts — Глобальное состояние ошибок в файлах
 * 
 * v2: Различает severity (error, warning, hint)
 * - Отслеживает только errors и warnings
 * - Hints игнорируются
 */

interface FileError {
  errorCount: number;
  warningCount: number;
  hintCount: number;
}

class ErrorState {
  private fileErrors = new Map<string, FileError>();

  /**
   * Установить количество ошибок в файле
   */
  setFileError(filePath: string, errorCount: number, warningCount: number = 0, hintCount: number = 0): void {
    this.fileErrors.set(filePath, { errorCount, warningCount, hintCount });
  }

  /**
   * Очистить ошибки для файла
   */
  clearFile(filePath: string): void {
    this.fileErrors.delete(filePath);
  }

  /**
   * Проверить есть ли ошибки (только errors, не warnings/hints)
   */
  hasErrors(): boolean {
    for (const [, state] of this.fileErrors) {
      if (state.errorCount > 0) return true;
    }
    return false;
  }

  /**
   * Проверить есть ли значимые проблемы (errors + warnings)
   */
  hasSignificantErrors(): boolean {
    for (const [, state] of this.fileErrors) {
      if (state.errorCount > 0 || state.warningCount > 0) return true;
    }
    return false;
  }

  /**
   * Получить общее количество ошибок (только errors)
   */
  getErrorCount(): number {
    let count = 0;
    for (const [, state] of this.fileErrors) {
      count += state.errorCount;
    }
    return count;
  }

  /**
   * Получить общее количество warnings
   */
  getWarningCount(): number {
    let count = 0;
    for (const [, state] of this.fileErrors) {
      count += state.warningCount;
    }
    return count;
  }

  /**
   * Получить количество файлов с ошибками
   */
  getFilesWithErrorCount(): number {
    let count = 0;
    for (const [, state] of this.fileErrors) {
      if (state.errorCount > 0) count++;
    }
    return count;
  }

  /**
   * Получить список файлов с ошибками
   */
  getFilesWithErrors(): string[] {
    const files: string[] = [];
    for (const [file, state] of this.fileErrors) {
      if (state.errorCount > 0) files.push(file);
    }
    return files;
  }

  /**
   * Сбросить всё состояние
   */
  reset(): void {
    this.fileErrors.clear();
  }
}

export const errorState = new ErrorState();
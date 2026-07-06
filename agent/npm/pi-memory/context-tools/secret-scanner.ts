/**
 * secret-scanner.ts — Утилита для обнаружения секретов в текстах.
 * 
 * Блокирует сохранение:
 * - API keys (OpenAI, GitHub, etc.)
 * - Токенов (Bearer, JWT)
 * - SSH ключей
 * - Паролей
 * 
 * v12: Исправлен баг с indexOf — теперь корректно определяет позицию
 *      каждого вхождения, даже если секрет встречается несколько раз.
 * v13: Улучшен high_entropy паттерн:
 *      - Увеличен порог с 40 до 64 символов (git hashes = 40 символов)
 *      - Добавлен whitelist для известных не-секретных форматов
 *      - Исключены строки, похожие на git commit hashes
 */

export interface ScanResult {
  hasSecret: boolean;
  secrets: Array<{
    type: string;
    pattern: string;
    location: string;
  }>;
}

/**
 * v13: Whitelist для строк, которые НЕ являются секретами,
 * но могут попасть под high_entropy паттерн.
 */
const HIGH_ENTROPY_WHITELIST = [
  // Git commit hashes (40 hex символов)
  /^[a-f0-9]{40}$/i,
  // SHA-256 hashes (64 hex символа, но часто встречаются в логах)
  /^[a-f0-9]{64}$/i,
  // UUID v4 (36 символов с дефисами)
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  // Base64 padding (часто в логах)
  /^={2,}$/,
  // Пустые или повторяющиеся символы
  /^(.)\1+$/,
];

/**
 * Проверяет, является ли строка известным не-секретным форматом.
 */
function isWhitelisted(value: string): boolean {
  return HIGH_ENTROPY_WHITELIST.some(pattern => pattern.test(value));
}

const SECRET_PATTERNS = [
  // OpenAI API keys
  {
    type: 'openai_key',
    pattern: /sk-[a-zA-Z0-9]{32,}/g,
    description: 'OpenAI API key',
  },
  // GitHub tokens
  {
    type: 'github_token',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    description: 'GitHub personal access token',
  },
  {
    type: 'github_fine_grained',
    pattern: /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
    description: 'GitHub fine-grained token',
  },
  // Bearer tokens
  {
    type: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/g,
    description: 'Bearer token',
  },
  // JWT tokens
  {
    type: 'jwt',
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    description: 'JWT token',
  },
  // SSH private keys
  {
    type: 'ssh_key',
    pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/g,
    description: 'SSH/PGP private key',
  },
  // AWS keys
  {
    type: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS access key',
  },
  // Generic passwords in code
  {
    type: 'password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi,
    description: 'Hardcoded password',
  },
  // API keys in headers
  {
    type: 'api_key_header',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{16,}["']/gi,
    description: 'API key in code',
  },
  // Slack tokens
  {
    type: 'slack_token',
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
    description: 'Slack token',
  },
  // Stripe keys
  {
    type: 'stripe_key',
    pattern: /(?:sk|pk)_(test|live)_[0-9a-zA-Z]{24,}/g,
    description: 'Stripe API key',
  },
  // v13: Generic secrets (high entropy strings) — увеличен порог до 64
  // Git commit hashes (40 символов) теперь игнорируются через whitelist
  {
    type: 'high_entropy',
    pattern: /["']([a-zA-Z0-9]{64,})["']/g,
    description: 'High entropy string (possible secret)',
    isHighEntropy: true,  // ← флаг для whitelist проверки
  },
];

/**
 * Сканирует текст на наличие секретов.
 * 
 * v12: Использует matchAll() для корректного определения позиции
 *      каждого вхождения, даже при дубликатах.
 * v13: Добавлена whitelist проверка для high_entropy паттерна.
 */
export function scanForSecrets(text: string): ScanResult {
  const secrets: ScanResult['secrets'] = [];
  
  for (const { type, pattern, description, isHighEntropy } of SECRET_PATTERNS) {
    // Создаём новый RegExp с флагом g, чтобы matchAll работал
    const globalPattern = new RegExp(
      pattern.source, 
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
    );
    
    const matches = Array.from(text.matchAll(globalPattern));
    
    for (const match of matches) {
      // v13: Для high_entropy проверяем whitelist
      if (isHighEntropy) {
        // match[1] — это содержимое в кавычках (первая capture group)
        const secretValue = match[1] || match[0];
        if (isWhitelisted(secretValue)) {
          continue;  // Пропускаем — это git hash или другой известный формат
        }
      }
      
      // match.index — точная позиция вхождения
      const index = match.index ?? -1;
      const location = index >= 0 ? `position ${index}` : 'unknown';
      
      secrets.push({
        type,
        pattern: description,
        location,
      });
    }
  }
  
  return {
    hasSecret: secrets.length > 0,
    secrets,
  };
}

/**
 * Маскирует секрет в тексте (заменяет на [REDACTED]).
 * 
 * v13: Также учитывает whitelist для high_entropy.
 */
export function redactSecret(text: string): string {
  let redacted = text;
  
  for (const { pattern, isHighEntropy } of SECRET_PATTERNS) {
    if (isHighEntropy) {
      // Для high_entropy используем callback, чтобы проверить whitelist
      redacted = redacted.replace(pattern, (match, secretValue) => {
        if (isWhitelisted(secretValue)) {
          return match;  // Не заменяем — это не секрет
        }
        return match.replace(secretValue, '[REDACTED]');
      });
    } else {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
  }
  
  return redacted;
}
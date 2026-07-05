/**
 * secret-scanner.ts — Утилита для обнаружения секретов в текстах.
 * 
 * Блокирует сохранение:
 * - API keys (OpenAI, GitHub, etc.)
 * - Токенов (Bearer, JWT)
 * - SSH ключей
 * - Паролей
 */

export interface ScanResult {
  hasSecret: boolean;
  secrets: Array<{
    type: string;
    pattern: string;
    location: string;
  }>;
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
  // Generic secrets (high entropy strings)
  {
    type: 'high_entropy',
    pattern: /["'][a-zA-Z0-9]{40,}["']/g,
    description: 'High entropy string (possible secret)',
  },
];

/**
 * Сканирует текст на наличие секретов.
 */
export function scanForSecrets(text: string): ScanResult {
  const secrets: ScanResult['secrets'] = [];
  
  for (const { type, pattern, description } of SECRET_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Находим позицию в тексте
        const index = text.indexOf(match);
        const location = `position ${index}`;
        
        secrets.push({
          type,
          pattern: description,
          location,
        });
      }
    }
  }
  
  return {
    hasSecret: secrets.length > 0,
    secrets,
  };
}

/**
 * Маскирует секрет в тексте (заменяет на [REDACTED]).
 */
export function redactSecret(text: string): string {
  let redacted = text;
  
  for (const { pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  
  return redacted;
}
import { z } from 'zod';

/**
 * Input validation schema for compliance queries.
 */
export const queryInputSchema = z.object({
  query: z
    .string()
    .min(5, 'Query must be at least 5 characters')
    .max(2000, 'Query must be at most 2000 characters'),
  filter: z
    .object({
      department: z.enum(['BD', 'FSD', 'EPD', 'EMSD', 'HA']).optional(),
      documentType: z
        .enum([
          'code_of_practice',
          'design_manual',
          'practice_note',
          'circular_letter',
          'ordinance',
        ])
        .optional(),
      capNumber: z.string().optional(),
    })
    .optional(),
});

export type QueryInput = z.infer<typeof queryInputSchema>;

/**
 * Prompt injection detection patterns.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+(instructions|rules|context)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /forget\s+(all\s+)?your\s+(instructions|rules|training)/i,
  /new\s+instruction[s]?\s*:/i,
  /system\s*prompt\s*:/i,
  /\bDAN\b.*\bmode\b/i,
  /jailbreak/i,
  /bypass\s+(your\s+)?(safety|restrictions|rules|filters)/i,
  /pretend\s+(you\s+)?(are|to\s+be)/i,
  /roleplay\s+as/i,
  /act\s+as\s+(if|a|an|the)/i,
  /override\s+(your\s+)?(system|instructions|rules)/i,
  /\[INST\]/i,
  /\<\|im_start\|\>/i,
  /\<system\>/i,
  /<\/?(?:system|human|assistant)>/i,
  /base64_decode/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /import\s+os/i,
  /subprocess/i,
  /\\x[0-9a-f]{2}/i,
];

/**
 * Check if input contains potential prompt injection.
 */
export function detectInjection(input: string): {
  detected: boolean;
  patterns: string[];
} {
  const matched: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      matched.push(pattern.source);
    }
  }

  return {
    detected: matched.length > 0,
    patterns: matched,
  };
}

/**
 * Sanitize input by removing potentially dangerous content.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // control chars
    .trim();
}

/**
 * Validate and sanitize query input.
 */
export function validateQueryInput(raw: unknown): {
  valid: boolean;
  data?: QueryInput;
  error?: string;
  injectionDetected?: boolean;
} {
  const parsed = queryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, error: parsed.error.issues[0]?.message };
  }

  const injection = detectInjection(parsed.data.query);
  if (injection.detected) {
    return {
      valid: false,
      error: 'Query contains disallowed content',
      injectionDetected: true,
    };
  }

  return {
    valid: true,
    data: {
      ...parsed.data,
      query: sanitizeInput(parsed.data.query),
    },
  };
}

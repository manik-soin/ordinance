import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  COHERE_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SCRAPE_CONCURRENCY: z.coerce.number().default(3),
  PDF_STORAGE_DIR: z.string().default('./data/pdfs'),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = configSchema.parse(process.env);
  }
  return _config;
}

export function getConfigSafe(): Config | null {
  try {
    return getConfig();
  } catch {
    return null;
  }
}

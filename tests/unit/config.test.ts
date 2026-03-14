import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    // Reset cached config
    vi.resetModules();
  });

  it('parses valid configuration', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.PORT = '4000';
    process.env.NODE_ENV = 'test';

    const { getConfig } = await import('../../src/config.js');
    const config = getConfig();

    expect(config.OPENAI_API_KEY).toBe('sk-test123');
    expect(config.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('test');
  });

  it('uses default values for optional fields', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.PORT;
    delete process.env.SCRAPE_CONCURRENCY;
    delete process.env.PDF_STORAGE_DIR;

    const { getConfig } = await import('../../src/config.js');
    const config = getConfig();

    expect(config.PORT).toBe(3000);
    // NODE_ENV may be 'test' in vitest context
    expect(['development', 'test', 'production']).toContain(config.NODE_ENV);
    expect(config.SCRAPE_CONCURRENCY).toBe(3);
    expect(config.PDF_STORAGE_DIR).toBe('./data/pdfs');
  });

  it('throws on missing required OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow();
  });

  it('throws on missing required DATABASE_URL', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    delete process.env.DATABASE_URL;

    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow();
  });

  it('throws on invalid DATABASE_URL', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'not-a-url';

    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow();
  });

  it('throws on invalid NODE_ENV', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.NODE_ENV = 'staging';

    const { getConfig } = await import('../../src/config.js');
    expect(() => getConfig()).toThrow();
  });

  it('getConfigSafe returns null on invalid config', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;

    const { getConfigSafe } = await import('../../src/config.js');
    const config = getConfigSafe();
    expect(config).toBeNull();
  });

  it('getConfigSafe returns config on valid config', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    const { getConfigSafe } = await import('../../src/config.js');
    const config = getConfigSafe();
    expect(config).not.toBeNull();
    expect(config!.OPENAI_API_KEY).toBe('sk-test123');
  });

  it('coerces PORT from string to number', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.PORT = '8080';

    const { getConfig } = await import('../../src/config.js');
    const config = getConfig();
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('COHERE_API_KEY is optional', async () => {
    process.env.OPENAI_API_KEY = 'sk-test123';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    delete process.env.COHERE_API_KEY;

    const { getConfig } = await import('../../src/config.js');
    const config = getConfig();
    expect(config.COHERE_API_KEY).toBeUndefined();
  });
});

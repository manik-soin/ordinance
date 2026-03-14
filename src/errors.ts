/**
 * Base error class for HK Compliance RAG errors.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when a requested resource is not found.
 */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when input validation fails.
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when an external service (OpenAI, Cohere, etc.) fails.
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(message: string, service: string) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 502);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Thrown when rate limit is exceeded.
 */
export class RateLimitError extends AppError {
  constructor() {
    super('Too many requests. Please try again later.', 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Thrown when prompt injection is detected.
 */
export class InjectionDetectedError extends AppError {
  constructor() {
    super('Query contains disallowed content', 'INJECTION_DETECTED', 400);
    this.name = 'InjectionDetectedError';
  }
}

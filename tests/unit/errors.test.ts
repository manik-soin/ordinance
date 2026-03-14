import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ExternalServiceError,
  RateLimitError,
  InjectionDetectedError,
} from '../../src/errors.js';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('sets message, code, and statusCode', () => {
      const err = new AppError('test error', 'TEST_CODE', 418);
      expect(err.message).toBe('test error');
      expect(err.code).toBe('TEST_CODE');
      expect(err.statusCode).toBe(418);
      expect(err.name).toBe('AppError');
    });

    it('defaults statusCode to 500', () => {
      const err = new AppError('server error', 'INTERNAL');
      expect(err.statusCode).toBe(500);
    });

    it('is an instance of Error', () => {
      const err = new AppError('test', 'TEST');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
    });
  });

  describe('NotFoundError', () => {
    it('has 404 status and NOT_FOUND code', () => {
      const err = new NotFoundError('resource not found');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.name).toBe('NotFoundError');
      expect(err.message).toBe('resource not found');
    });

    it('is an instance of AppError', () => {
      expect(new NotFoundError('test')).toBeInstanceOf(AppError);
    });
  });

  describe('ValidationError', () => {
    it('has 400 status and VALIDATION_ERROR code', () => {
      const err = new ValidationError('invalid input');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('ValidationError');
    });
  });

  describe('ExternalServiceError', () => {
    it('has 502 status and includes service name', () => {
      const err = new ExternalServiceError('OpenAI timeout', 'openai');
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(err.service).toBe('openai');
      expect(err.message).toBe('OpenAI timeout');
      expect(err.name).toBe('ExternalServiceError');
    });

    it('is an instance of AppError', () => {
      expect(new ExternalServiceError('fail', 'cohere')).toBeInstanceOf(AppError);
    });
  });

  describe('RateLimitError', () => {
    it('has 429 status and fixed message', () => {
      const err = new RateLimitError();
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe('RATE_LIMIT');
      expect(err.message).toContain('Too many requests');
    });
  });

  describe('InjectionDetectedError', () => {
    it('has 400 status and INJECTION_DETECTED code', () => {
      const err = new InjectionDetectedError();
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('INJECTION_DETECTED');
      expect(err.message).toContain('disallowed');
    });
  });
});

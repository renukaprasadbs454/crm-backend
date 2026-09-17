import { describe, it, expect } from 'vitest';
import {
  createLeadSchema,
  publicLeadSchema,
  updateStageSchema,
  createActivitySchema,
  loginSchema,
} from '../src/validators/schemas.js';

describe('loginSchema', () => {
  it('rejects a short password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(result.success).toBe(false);
  });
});

describe('createLeadSchema', () => {
  it('applies default stage and interest', () => {
    const parsed = createLeadSchema.parse({
      phone: '9876543210',
      collegeName: 'Test College',
    });
    expect(parsed.stage).toBe('NEW');
    expect(parsed.interest).toBe('ON_HOLD');
  });

  it('rejects an invalid phone', () => {
    const result = createLeadSchema.parse.bind(null, {
      phone: 'abc',
      collegeName: 'Test College',
    });
    expect(result).toThrow();
  });

  it('requires a college name', () => {
    const result = createLeadSchema.safeParse({ phone: '9876543210' });
    expect(result.success).toBe(false);
  });
});

describe('publicLeadSchema', () => {
  it('accepts a minimal website submission', () => {
    const result = publicLeadSchema.safeParse({
      phone: '9876543210',
      collegeName: 'Test College',
      message: 'Please call me',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty-string email', () => {
    const result = publicLeadSchema.safeParse({
      phone: '9876543210',
      collegeName: 'Test College',
      email: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('updateStageSchema', () => {
  it('accepts a valid stage', () => {
    expect(updateStageSchema.parse({ stage: 'QUALIFIED' }).stage).toBe('QUALIFIED');
  });

  it('rejects an unknown stage', () => {
    expect(updateStageSchema.safeParse({ stage: 'BOGUS' }).success).toBe(false);
  });
});

describe('createActivitySchema', () => {
  it('defaults type to NOTE', () => {
    expect(createActivitySchema.parse({ body: 'called the lead' }).type).toBe('NOTE');
  });

  it('requires a non-empty body', () => {
    expect(createActivitySchema.safeParse({ type: 'CALL', body: '' }).success).toBe(false);
  });
});

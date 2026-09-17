import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../src/utils/jwt.js';

describe('jwt utils', () => {
  it('signs and verifies a token round-trip', () => {
    const token = signToken({ sub: 'user-1', role: 'COMPANY_ADMIN' });
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('COMPANY_ADMIN');
  });

  it('rejects a tampered token', () => {
    const token = signToken({ sub: 'user-1' });
    expect(() => verifyToken(token + 'tampered')).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { getPagination, paginated } from '../src/utils/pagination.js';

describe('getPagination', () => {
  it('applies sensible defaults', () => {
    expect(getPagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('computes skip from page and limit', () => {
    expect(getPagination({ page: '3', limit: '10' })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it('clamps limit to a max of 100', () => {
    expect(getPagination({ limit: '9999' }).limit).toBe(100);
  });

  it('falls back to the default limit for falsy/invalid values', () => {
    expect(getPagination({ limit: '0' }).limit).toBe(20);
    expect(getPagination({ limit: 'abc' }).limit).toBe(20);
  });

  it('never returns a page below 1', () => {
    expect(getPagination({ page: '-5' }).page).toBe(1);
  });
});

describe('paginated', () => {
  it('wraps items with pagination metadata', () => {
    const result = paginated([{ id: 1 }], 42, 2, 20);
    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({ total: 42, page: 2, limit: 20, pages: 3 });
  });

  it('always reports at least one page', () => {
    expect(paginated([], 0, 1, 20).pagination.pages).toBe(1);
  });
});

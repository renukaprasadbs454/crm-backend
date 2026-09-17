import { describe, it, expect, vi } from 'vitest';
import { ok, fail } from '../src/utils/response.js';

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('response helpers', () => {
  it('ok() defaults to 200 and success:true', () => {
    const res = mockRes();
    ok(res, { id: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'OK',
      data: { id: 1 },
    });
  });

  it('ok() honours a custom status and message', () => {
    const res = mockRes();
    ok(res, null, 'Created', 201);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Created',
      data: null,
    });
  });

  it('fail() defaults to 400 and success:false', () => {
    const res = mockRes();
    fail(res, 'Bad request');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Bad request',
      errors: null,
    });
  });
});

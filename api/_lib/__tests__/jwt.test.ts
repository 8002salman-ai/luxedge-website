import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyJwtHs256, isAdminClaim } from '../jwt';

const SECRET = '0123456789abcdef0123456789abcdef';

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function signToken(
  payload: Record<string, unknown>,
  secret = SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('verifyJwtHs256', () => {
  it('verifies a valid token and returns the payload', () => {
    const token = signToken({ sub: 'user-1', email: 'admin@luxedge.us', exp: Math.floor(Date.now() / 1000) + 3600 });
    const payload = verifyJwtHs256(token, SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('admin@luxedge.us');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = signToken({ sub: 'user-1' }, 'wrong-secret-wrong-secret-wrong');
    expect(() => verifyJwtHs256(token, SECRET)).toThrow(/signature/i);
  });

  it('rejects an expired token', () => {
    const token = signToken({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(() => verifyJwtHs256(token, SECRET)).toThrow(/expired/i);
  });

  it('rejects a tampered payload', () => {
    const token = signToken({ sub: 'user-1' });
    const [h, , sig] = token.split('.');
    const tampered = `${h}.${b64url(JSON.stringify({ sub: 'attacker' }))}.${sig}`;
    expect(() => verifyJwtHs256(tampered, SECRET)).toThrow(/signature/i);
  });

  it('rejects alg=none (algorithm confusion)', () => {
    const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const p = b64url(JSON.stringify({ sub: 'user-1' }));
    const token = `${h}.${p}.`;
    expect(() => verifyJwtHs256(token, SECRET)).toThrow(/algorithm/i);
  });

  it('rejects a non-HS256 algorithm header', () => {
    const token = signToken({ sub: 'user-1' }, SECRET, { alg: 'RS256', typ: 'JWT' });
    expect(() => verifyJwtHs256(token, SECRET)).toThrow(/algorithm/i);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyJwtHs256('not-a-token', SECRET)).toThrow(/malformed/i);
    expect(() => verifyJwtHs256('a.b', SECRET)).toThrow(/malformed/i);
  });

  it('rejects tokens without a subject', () => {
    const token = signToken({ email: 'x@y.z' });
    expect(() => verifyJwtHs256(token, SECRET)).toThrow(/subject/i);
  });

  it('rejects when the secret is missing or too short', () => {
    const token = signToken({ sub: 'user-1' });
    expect(() => verifyJwtHs256(token, '')).toThrow(/not configured/i);
    expect(() => verifyJwtHs256(token, 'short')).toThrow(/not configured/i);
  });
});

describe('isAdminClaim', () => {
  it('is true only for app_metadata.role = admin', () => {
    expect(
      isAdminClaim(verifyJwtHs256(signToken({ sub: 'a', app_metadata: { role: 'admin' } }), SECRET))
    ).toBe(true);
    expect(
      isAdminClaim(verifyJwtHs256(signToken({ sub: 'b', app_metadata: { role: 'buyer' } }), SECRET))
    ).toBe(false);
    expect(isAdminClaim(verifyJwtHs256(signToken({ sub: 'c' }), SECRET))).toBe(false);
  });
});

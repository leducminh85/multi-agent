import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { redact } from '../src/core/audit.js';
import { SecretBox, hashPassword, hashToken, verifyPassword } from '../src/core/crypto.js';
import { maskSecret } from '../src/core/util.js';

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox(crypto.randomBytes(32));

  it('round-trips secrets and never stores plaintext', () => {
    const enc = box.encrypt('sk-ant-super-secret');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('super-secret');
    expect(box.decrypt(enc)).toBe('sk-ant-super-secret');
  });

  it('uses a random IV (same input → different ciphertext)', () => {
    expect(box.encrypt('x')).not.toBe(box.encrypt('x'));
  });

  it('detects tampering', () => {
    const enc = box.encrypt('hello');
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });

  it('fails with a different key', () => {
    const other = new SecretBox(crypto.randomBytes(32));
    expect(() => other.decrypt(box.encrypt('hello'))).toThrow();
  });
});

describe('password hashing', () => {
  it('verifies correct passwords only', () => {
    const h = hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
  });
});

describe('secret hygiene helpers', () => {
  it('masks secrets', () => {
    expect(maskSecret('sk-1234567890')).toBe('••••7890');
  });
  it('redacts secret-looking keys in audit details', () => {
    expect(redact({ apiKey: 'x', nested: { password: 'y', name: 'ok' }, count: 2 })).toEqual({
      apiKey: '[redacted]',
      nested: { password: '[redacted]', name: 'ok' },
      count: 2,
    });
  });
});

import { describe, it, expect } from 'vitest';
import { isBlockedIp, isBlockedHostname, validateFetchTarget } from '../ssrf';

describe('isBlockedIp', () => {
  it('blocks loopback and cloud metadata ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.8.8.8')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // AWS/GCP metadata
    expect(isBlockedIp('169.254.0.1')).toBe(true);
  });

  it('blocks private RFC1918 ranges', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
  });

  it('blocks CGNAT and benchmark ranges, allows public IPs', () => {
    expect(isBlockedIp('100.64.0.1')).toBe(true);
    expect(isBlockedIp('100.127.255.255')).toBe(true);
    expect(isBlockedIp('198.18.0.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('172.32.0.1')).toBe(false);
    expect(isBlockedIp('100.128.0.1')).toBe(false);
  });

  it('blocks IPv6 private/ULA/link-local', () => {
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fd12:3456::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('blocks local hostnames and cloud metadata hostnames', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('LOCALHOST')).toBe(true);
    expect(isBlockedHostname('localhost.localdomain')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('example.com')).toBe(false);
  });
});

describe('validateFetchTarget (no network needed — all cases blocked pre-fetch)', () => {
  it('rejects localhost targets', async () => {
    const err = await validateFetchTarget('http://localhost/admin');
    expect(err).toContain('blocked');
    const withPort = await validateFetchTarget('http://localhost:8080/admin');
    expect(withPort).not.toBeNull(); // blocked either way (port or host check)
  });

  it('rejects IP-literal private targets', async () => {
    expect(await validateFetchTarget('http://169.254.169.254/latest/meta-data/')).toContain('Blocked address');
    expect(await validateFetchTarget('http://10.0.0.1/')).toContain('Blocked address');
  });

  it('rejects non-http(s) protocols', async () => {
    expect(await validateFetchTarget('ftp://example.com/file')).toContain('Only http(s)');
    expect(await validateFetchTarget('file:///etc/passwd')).toContain('Only http(s)');
  });

  it('rejects URLs with embedded credentials', async () => {
    expect(await validateFetchTarget('https://user:pass@example.com/')).toContain('credentials');
  });

  it('rejects non-standard ports', async () => {
    expect(await validateFetchTarget('http://example.com:8080/')).toContain('Non-standard ports');
  });

  it('rejects garbage input', async () => {
    expect(await validateFetchTarget('not a url')).not.toBeNull();
  });
});

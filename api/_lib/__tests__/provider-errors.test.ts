// ============================================================================
// LUXEDGE — classifyProviderStatus unit tests
//
// The classifier turns raw provider HTTP failures into one of four categories
// (auth / quota / model / unknown) with an actionable, fully server-authored
// message. Raw provider bodies are sniffed but NEVER echoed back to clients.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { classifyProviderStatus } from '../providers.js';

describe('classifyProviderStatus', () => {
  it('auth: 401 → invalid-key message with a re-attach action', () => {
    const r = classifyProviderStatus('openai', 401, '{"error":{"message":"Incorrect API key provided"}}');
    expect(r.problem).toBe('auth');
    expect(r.message).toContain('rejected the key (HTTP 401)');
    expect(r.message).toContain('AI Hub → Attach Key');
  });

  it('auth: 403 with no quota wording stays auth', () => {
    const r = classifyProviderStatus('gemini', 403, '{"error":{"status":"PERMISSION_DENIED"}}');
    expect(r.problem).toBe('auth');
  });

  it('quota: 429 → billing action, provider-specific', () => {
    const gemini = classifyProviderStatus('gemini', 429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}');
    expect(gemini.problem).toBe('quota');
    expect(gemini.message).toContain('Enable billing on the Google Cloud project');

    const openai = classifyProviderStatus('openai', 429, 'rate limit');
    expect(openai.problem).toBe('quota');
    expect(openai.message).toContain('Top up billing at platform.openai.com');
  });

  it('quota: 403 carrying quota/exhausted wording is quota, not auth', () => {
    const r = classifyProviderStatus('gemini', 403, '{"error":{"message":"insufficient quota to generate media"}}');
    expect(r.problem).toBe('quota');
    expect(r.message).toContain('billing');
  });

  it('model: 404 → model-missing message', () => {
    const r = classifyProviderStatus('gemini', 404, 'model not found');
    expect(r.problem).toBe('model');
    expect(r.message).toContain('does not offer the requested model');
  });

  it('model: 400 whose body names an unknown model', () => {
    const r = classifyProviderStatus('openai', 400, '{"error":{"message":"The model gpt-9 does not exist"}}');
    expect(r.problem).toBe('model');
  });

  it('unknown: other statuses keep a safe generic message', () => {
    const r = classifyProviderStatus('deepseek', 500, 'boom');
    expect(r.problem).toBe('unknown');
    expect(r.message).toContain('Check server logs');
  });

  it('never echoes raw provider bodies (keys/headers stay server-side)', () => {
    const r = classifyProviderStatus('openai', 401, 'sk-live-secret-abc123 key rejected for account acct_xyz');
    expect(r.message).not.toContain('sk-live-secret-abc123');
    expect(r.message).not.toContain('acct_xyz');
  });
});

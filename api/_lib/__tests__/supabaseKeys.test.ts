import { describe, expect, it } from 'vitest';
import { supabaseServerHeaders } from '../supabaseKeys';

describe('supabaseServerHeaders', () => {
  it('uses modern secret keys only as apikey values', () => {
    expect(supabaseServerHeaders(' sb_secret_example ', { 'Content-Type': 'application/json' })).toEqual({
      apikey: 'sb_secret_example',
      'Content-Type': 'application/json',
    });
  });

  it('preserves legacy service-role JWT compatibility', () => {
    expect(supabaseServerHeaders('legacy.jwt.value')).toEqual({
      apikey: 'legacy.jwt.value',
      Authorization: 'Bearer legacy.jwt.value',
    });
  });
});

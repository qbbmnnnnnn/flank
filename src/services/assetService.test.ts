import { describe, expect, it } from 'vitest';
import { assetId, safeExternalUrl } from './assetService';

const hash = 'a'.repeat(64);

describe('assetService URL boundaries', () => {
  it('accepts only stable content-addressed asset URIs', () => {
    expect(assetId(`flank-asset://${hash}`)).toBe(hash);
    expect(assetId('flank-asset://../../secret')).toBeNull();
    expect(assetId('file:///secret.png')).toBeNull();
  });

  it('allows web and mail links but rejects executable and local protocols', () => {
    expect(safeExternalUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(safeExternalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('file:///secret.txt')).toBeNull();
  });
});

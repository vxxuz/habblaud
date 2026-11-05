import { describe, expect, it } from 'vitest';
import { findAgyBin, runnableAgyBin } from './antigravity-bin';

describe('Antigravity Binary Locator', () => {
  it('respects HABBLAUD_ANTIGRAVITY_BIN env override', () => {
    const bin = findAgyBin({ HABBLAUD_ANTIGRAVITY_BIN: '/custom/path/to/agy' });
    expect(bin).toBe('/custom/path/to/agy');
  });

  it('finds agy in PATH or ~/.local/bin', () => {
    // Current environment has agy in ~/.local/bin/agy or in PATH
    const bin = runnableAgyBin(process.env);
    expect(bin).toBeDefined();
    expect(bin).toMatch(/agy(\.exe)?$/);
  });

  it('returns undefined when binary does not exist', () => {
    const bin = runnableAgyBin({ PATH: '/empty/dir', HOME: '/nonexistent', HABBLAUD_ANTIGRAVITY_BIN: '' });
    expect(bin).toBeUndefined();
  });
});

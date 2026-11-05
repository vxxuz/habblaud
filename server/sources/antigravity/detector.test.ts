import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectActiveLocks, getAntigravityHome, parseProcLocks } from './detector';

describe('Antigravity Lock Detector', () => {
  it('detects Antigravity home from env or default', () => {
    expect(getAntigravityHome({ ANTIGRAVITY_HOME: '/custom/agy' })).toBe('/custom/agy');
    expect(getAntigravityHome({ GEMINI_CLI_HOME: '/gemini/agy' })).toBe('/gemini/agy');
    expect(getAntigravityHome({}, '/home/user')).toBe('/home/user/.gemini/antigravity-cli');
  });

  it('parses /proc/locks to map inodes to PIDs', () => {
    const sample = `1: POSIX  ADVISORY  WRITE 1234 08:01:99999 0 EOF
2: FLOCK  ADVISORY  WRITE 5678 08:01:12345 0 EOF
3: FLOCK  ADVISORY  WRITE 9999 08:01:67890 0 EOF`;
    const map = parseProcLocks(sample);
    expect(map.get(12345)).toBe(5678);
    expect(map.get(67890)).toBe(9999);
    expect(map.get(99999)).toBe(1234);
  });

  it('filters active locks by inode and process liveness', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agy-test-'));
    try {
      const lock1 = join(tmp, 'active-session-1.lock');
      const lock2 = join(tmp, 'stale-session-2.lock');
      writeFileSync(lock1, '');
      writeFileSync(lock2, '');

      const stat1 = statSync(lock1);
      const stat2 = statSync(lock2);

      // Current node process PID is alive
      const currentPid = process.pid;
      const fakeLocksContent = `1: FLOCK  ADVISORY  WRITE ${currentPid} 08:01:${stat1.ino} 0 EOF`;

      const active = detectActiveLocks(tmp, {
        procLocksContent: fakeLocksContent,
        isPidAlive: (pid) => pid === currentPid,
      });

      expect(active).toContain('active-session-1');
      expect(active).not.toContain('stale-session-2');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back to mtime when proc/locks is unavailable', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agy-mtime-'));
    try {
      const activeLock = join(tmp, 'recent.lock');
      const staleLock = join(tmp, 'old.lock');
      writeFileSync(activeLock, '');
      writeFileSync(staleLock, '');

      const now = Date.now() / 1000;
      // Set old lock to 2 hours ago
      utimesSync(staleLock, now - 7200, now - 7200);

      const active = detectActiveLocks(tmp, {
        procLocksContent: null,
        maxAgeMs: 10 * 60 * 1000, // 10 minutes
      });

      expect(active).toContain('recent');
      expect(active).not.toContain('old');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

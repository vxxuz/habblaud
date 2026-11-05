import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactScanner } from './artifacts';

describe('ArtifactScanner', () => {
  it('scans artifacts requiring feedback and filters out those that do not', () => {
    const testDir = join(tmpdir(), `agy-artifact-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const scanner = new ArtifactScanner({});

      // Artifact 1: requestFeedback = true
      writeFileSync(join(testDir, 'plan.md'), '# Implementation Plan');
      writeFileSync(
        join(testDir, 'plan.md.metadata.json'),
        JSON.stringify({
          summary: 'Executive Plan',
          requestFeedback: true,
          userFacing: true,
          updatedAt: new Date(1000).toISOString(),
        }),
      );

      // Artifact 2: requestFeedback = false (informational only)
      writeFileSync(join(testDir, 'notes.md'), '# Notes');
      writeFileSync(
        join(testDir, 'notes.md.metadata.json'),
        JSON.stringify({
          summary: 'Internal Notes',
          requestFeedback: false,
          userFacing: false,
          updatedAt: new Date(2000).toISOString(),
        }),
      );

      const pending = scanner.scanSession('s1', testDir);
      expect(pending).toBeDefined();
      expect(pending?.name).toBe('plan.md');
      expect(pending?.summary).toBe('Executive Plan');

      // Now approve plan.md
      scanner.approve('s1', 'plan.md');
      expect(scanner.isApproved('s1', 'plan.md')).toBe(true);

      // Subsequent scan returns undefined because plan.md is approved and notes.md does not require feedback
      const nextPending = scanner.scanSession('s1', testDir);
      expect(nextPending).toBeUndefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

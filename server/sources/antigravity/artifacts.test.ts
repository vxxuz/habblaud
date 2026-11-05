import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactScanner, isPlanArtifact, requiresCeoApproval } from './artifacts';

describe('ArtifactScanner', () => {
  it('identifies plan and review artifacts by filename pattern', () => {
    expect(isPlanArtifact('plan.md')).toBe(true);
    expect(isPlanArtifact('antigravity-integration-plan.md')).toBe(true);
    expect(isPlanArtifact('ceo-room-and-artifact-approval-design.md')).toBe(true);
    expect(isPlanArtifact('api-spec.md')).toBe(true);
    expect(isPlanArtifact('feature-proposal.md')).toBe(true);
    expect(isPlanArtifact('rencana-kerja.md')).toBe(true);

    expect(isPlanArtifact('notes.md')).toBe(false);
    expect(isPlanArtifact('todo.md')).toBe(false);
    expect(isPlanArtifact('scratch.txt')).toBe(false);
    expect(isPlanArtifact('output.json')).toBe(false);
  });

  it('determines whether CEO approval is required based on metadata and naming', () => {
    // Explicit requestFeedback: true always requires approval
    expect(requiresCeoApproval({ requestFeedback: true }, 'notes.md')).toBe(true);

    // Plan artifact with userFacing: true requires approval even if requestFeedback is false
    expect(requiresCeoApproval({ requestFeedback: false, userFacing: true }, 'feature-plan.md')).toBe(true);
    expect(requiresCeoApproval({ userFacing: true }, 'feature-design.md')).toBe(true);

    // Non-plan artifact with requestFeedback: false does NOT require approval
    expect(requiresCeoApproval({ requestFeedback: false, userFacing: true }, 'meeting-notes.md')).toBe(false);

    // Plan artifact with userFacing: false (internal) does NOT require approval
    expect(requiresCeoApproval({ requestFeedback: false, userFacing: false }, 'subagent-plan.md')).toBe(false);
  });

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

      // Artifact 3: plan artifact with requestFeedback = false, userFacing = true (Option 1)
      writeFileSync(join(testDir, 'migration-plan.md'), '# Migration Plan');
      writeFileSync(
        join(testDir, 'migration-plan.md.metadata.json'),
        JSON.stringify({
          summary: 'Database Migration Plan',
          requestFeedback: false,
          userFacing: true,
          updatedAt: new Date(3000).toISOString(),
        }),
      );

      // Migration plan is newest (updatedAt: 3000) and requires CEO approval
      const pending = scanner.scanSession('s1', testDir);
      expect(pending).toBeDefined();
      expect(pending?.name).toBe('migration-plan.md');
      expect(pending?.summary).toBe('Database Migration Plan');

      // Approve migration-plan.md
      scanner.approve('s1', 'migration-plan.md');
      expect(scanner.isApproved('s1', 'migration-plan.md')).toBe(true);

      // Next scan should return plan.md (updatedAt: 1000)
      const nextPending = scanner.scanSession('s1', testDir);
      expect(nextPending).toBeDefined();
      expect(nextPending?.name).toBe('plan.md');

      // Approve plan.md
      scanner.approve('s1', 'plan.md');

      // Subsequent scan returns undefined because notes.md does not require approval
      const finalPending = scanner.scanSession('s1', testDir);
      expect(finalPending).toBeUndefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

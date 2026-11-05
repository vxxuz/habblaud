import { describe, expect, it } from 'vitest';
import type { AgentInfo, PendingArtifact } from '../../../shared/types';
import {
  ceoDecisionPayload,
  findPendingArtifactAgent,
  formatArtifactTitle,
  formatArtifactSummary,
} from './ceo-card';

function mockAgent(id: string, pendingArtifact?: PendingArtifact): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: 'r',
    name: `Agent ${id}`,
    look: 'm',
    role: 'Engineer',
    sessionId: id,
    account: 'antigravity',
    status: pendingArtifact ? 'waiting' : 'working',
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: 0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 123,
    pendingArtifact,
  };
}

describe('CEO Approval Card Model & Logic', () => {
  it('findPendingArtifactAgent finds the agent waiting with pendingArtifact', () => {
    const a1 = mockAgent('a1');
    const a2 = mockAgent('a2', {
      id: 'feature-plan',
      summary: 'A new feature implementation plan',
      path: '/path/to/feature-plan.md',
      updatedAt: 1000,
    });
    const a3 = mockAgent('a3');

    const pending = findPendingArtifactAgent([a1, a2, a3]);
    expect(pending?.id).toBe('a2');
    expect(pending?.pendingArtifact?.id).toBe('feature-plan');
  });

  it('findPendingArtifactAgent returns undefined when no agent has pendingArtifact', () => {
    const a1 = mockAgent('a1');
    const a2 = mockAgent('a2');
    expect(findPendingArtifactAgent([a1, a2])).toBeUndefined();
  });

  it('formatArtifactTitle formats filename/id nicely', () => {
    expect(formatArtifactTitle('ceo-room-and-artifact-approval-plan.md')).toBe('ceo-room-and-artifact-approval-plan.md');
    expect(formatArtifactTitle('my-cool-plan')).toBe('my-cool-plan.md');
  });

  it('formatArtifactSummary handles empty or multiline text', () => {
    expect(formatArtifactSummary('')).toBe('No summary provided.');
    expect(formatArtifactSummary('Detailed step-by-step plan')).toBe('Detailed step-by-step plan');
  });

  it('ceoDecisionPayload creates correct POST bodies for approve and reject', () => {
    const approve = ceoDecisionPayload('ag1', 'plan-1', 'approve');
    expect(approve).toEqual({
      agentId: 'ag1',
      artifactId: 'plan-1',
      decision: 'approve',
    });

    const reject = ceoDecisionPayload('ag1', 'plan-1', 'reject', 'Needs structural improvements');
    expect(reject).toEqual({
      agentId: 'ag1',
      artifactId: 'plan-1',
      decision: 'reject',
      feedback: 'Needs structural improvements',
    });
  });
});

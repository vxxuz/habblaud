import { describe, expect, it } from 'vitest';
import {
  createAntigravitySessionState,
  describeToolCall,
  parseTranscriptLine,
} from './transcript';

describe('Antigravity Transcript Parser', () => {
  it('describes tool calls accurately', () => {
    expect(describeToolCall({ name: 'read_file', args: { Path: '/home/inok/test.ts' } })).toBe('Reading test.ts');
    expect(describeToolCall({ name: 'edit_file', args: { Path: '/home/inok/src/main.ts' } })).toBe('Editing main.ts');
    expect(describeToolCall({ name: 'write_file', args: { Path: '/home/inok/new.txt' } })).toBe('Creating new.txt');
    expect(describeToolCall({ name: 'run_command', args: { CommandLine: 'npm test' } })).toBe('Running: npm test');
    expect(describeToolCall({ name: 'search_web', args: { query: 'antigravity docs' } })).toBe('Searching web: antigravity docs');
    expect(describeToolCall({ name: 'ask_question' })).toBe('Waiting for answer');
    expect(describeToolCall({ name: 'invoke_subagent', args: { Role: 'Code Researcher' } })).toBe('Starting subagent (Code Researcher)');
  });

  it('updates state on USER_INPUT line', () => {
    const state = createAntigravitySessionState('conv-1');
    parseTranscriptLine(
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-05T12:00:00Z',
        content: 'Halo tolong buatkan fitur baru',
      }),
      state,
    );

    expect(state.status).toBe('working');
    expect(state.stepCount).toBe(1);
    expect(state.latestActivity?.text).toBe('Received user prompt');
  });

  it('updates state, tokens, and waiting status on ask_question tool', () => {
    const state = createAntigravitySessionState('conv-1');
    parseTranscriptLine(
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-05T12:01:00Z',
        input_tokens: 500,
        output_tokens: 150,
        tool_calls: [
          {
            name: 'ask_question',
            args: { questions: [{ question: 'Lanjutkan?' }] },
          },
        ],
      }),
      state,
    );

    expect(state.status).toBe('waiting');
    expect(state.waitingFor).toBe('Question');
    expect(state.inputTokens).toBe(500);
    expect(state.outputTokens).toBe(150);
  });

  it('accumulates tokens across multiple response steps', () => {
    const state = createAntigravitySessionState('conv-1');
    parseTranscriptLine(
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 1000,
        output_tokens: 200,
        tool_calls: [{ name: 'read_file', args: { Path: '/home/inok/file.ts' } }],
      }),
      state,
    );
    parseTranscriptLine(
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 1500,
        output_tokens: 300,
        content: 'Selesai!',
      }),
      state,
    );

    expect(state.inputTokens).toBe(2500);
    expect(state.outputTokens).toBe(500);
    expect(state.status).toBe('idle');
  });
});

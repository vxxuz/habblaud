import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  getSessionMetadata,
  listRecentSessions,
  openAntigravityDb,
  parseWorkspaceUris,
  type AntigravitySessionMeta,
} from './database';

describe('Antigravity Database Reader', () => {
  it('parses workspace URIs into local directory paths', () => {
    expect(parseWorkspaceUris('["file:///home/inok/project"]')).toEqual(['/home/inok/project']);
    expect(parseWorkspaceUris('["file:///home/inok/My%20Project"]')).toEqual(['/home/inok/My Project']);
    expect(parseWorkspaceUris('invalid')).toEqual([]);
    expect(parseWorkspaceUris('')).toEqual([]);
  });

  it('reads session metadata and list from SQLite database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        step_count INTEGER NOT NULL DEFAULT 0,
        last_modified_time TEXT NOT NULL,
        workspace_uris TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        parent_conversation_id TEXT NOT NULL DEFAULT '',
        agent_name TEXT NOT NULL DEFAULT '',
        not_fully_idle NUMERIC NOT NULL DEFAULT 0
      );
    `);

    db.exec(`
      INSERT INTO conversation_summaries (
        conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, parent_conversation_id, agent_name, not_fully_idle
      ) VALUES
      ('conv-1', 'Test Session 1', 'preview 1', 10, '2026-11-05 12:00:00', '["file:///home/inok/proj1"]', 'active', '', 'Antigravity', 1),
      ('conv-2', 'Subagent Session', 'preview sub', 5, '2026-11-05 12:05:00', '["file:///home/inok/proj1"]', 'active', 'conv-1', 'Researcher', 0);
    `);

    const meta1 = getSessionMetadata(db, 'conv-1');
    expect(meta1).toBeDefined();
    expect(meta1?.id).toBe('conv-1');
    expect(meta1?.title).toBe('Test Session 1');
    expect(meta1?.cwd).toBe('/home/inok/proj1');
    expect(meta1?.notFullyIdle).toBe(true);
    expect(meta1?.parentId).toBeUndefined();

    const meta2 = getSessionMetadata(db, 'conv-2');
    expect(meta2).toBeDefined();
    expect(meta2?.id).toBe('conv-2');
    expect(meta2?.parentId).toBe('conv-1');
    expect(meta2?.agentName).toBe('Researcher');
    expect(meta2?.notFullyIdle).toBe(false);

    const list = listRecentSessions(db, 10);
    expect(list.length).toBe(2);
    expect(list[0]?.id).toBe('conv-2'); // ordered by last_modified_time DESC

    db.close();
  });
});

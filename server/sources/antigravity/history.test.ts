import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AntigravityHistory } from './history';

describe('Antigravity History Provider', () => {
  it('lists recent sessions from conversation_summaries.db', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agy-hist-'));
    try {
      const dbPath = join(tmp, 'conversation_summaries.db');
      const db = new DatabaseSync(dbPath);
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
        INSERT INTO conversation_summaries VALUES
        ('conv-past-1', 'Past Project Task', '', 5, '2026-11-05 10:00:00Z', '["file:///home/inok/past-proj"]', 'done', '', 'Antigravity', 0),
        ('conv-live-2', 'Live Active Task', '', 2, '2026-11-05 11:00:00Z', '["file:///home/inok/live-proj"]', 'active', '', 'Antigravity', 1);
      `);
      db.close();

      const history = new AntigravityHistory({
        antigravityDir: tmp,
        accountId: 'antigravity:default',
        openAgentOf: (acc, sid) => (sid === 'conv-live-2' ? 'antigravity:conv-live-2' : undefined),
      });

      expect(history.hasAccount('antigravity:default')).toBe(true);
      expect(history.hasAccount('other:account')).toBe(false);

      const list = await history.list();
      expect(list.length).toBe(2);

      const live = list.find((s) => s.sessionId === 'conv-live-2');
      const past = list.find((s) => s.sessionId === 'conv-past-1');

      expect(live?.title).toBe('Live Active Task');
      expect(live?.project).toBe('/home/inok/live-proj');
      expect(live?.open).toBe(true);
      expect(live?.provider).toBe('antigravity');

      expect(past?.open).toBe(false);
      expect(past?.title).toBe('Past Project Task');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves session transcript path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agy-resolve-'));
    try {
      const convId = 'conv-test-123';
      const logDir = join(tmp, 'brain', convId, '.system_generated', 'logs');
      mkdirSync(logDir, { recursive: true });
      const transPath = join(logDir, 'transcript.jsonl');
      writeFileSync(transPath, '{"step_index":0}\n');

      const history = new AntigravityHistory({
        antigravityDir: tmp,
        accountId: 'antigravity:default',
      });

      const res = history.resolve('antigravity:default', convId);
      expect('path' in res).toBe(true);
      if ('path' in res) {
        expect(res.path).toBe(transPath);
        expect(typeof res.createParser).toBe('function');
      }

      const notFound = history.resolve('antigravity:default', 'non-existent');
      expect('status' in notFound && notFound.status).toBe(404);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

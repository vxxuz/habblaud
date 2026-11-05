import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { AntigravitySource } from './source';

setQuiet(true);

describe('AntigravitySource Integration', () => {
  let cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const c of cleanups) c();
    cleanups = [];
  });

  function setupTestEnv() {
    const tmp = mkdtempSync(join(tmpdir(), 'agy-source-'));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));

    const presenceDir = join(tmp, 'presence');
    const brainDir = join(tmp, 'brain');
    mkdirSync(presenceDir, { recursive: true });
    mkdirSync(brainDir, { recursive: true });

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
    db.close();

    let clock = Date.now();
    const now = () => clock;

    const accounts = new AccountsService({ dirs: [], home: tmp, env: {}, now, onChange: () => {} });
    const office = new Office({
      names: new NameStore(null),
      version: 'test',
      startedAt: clock,
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: (id) => accounts.find(id)?.detected.name,
      now,
    });

    const source = new AntigravitySource({
      accounts,
      office,
      antigravityDir: tmp,
      now,
      pollMs: 100,
      detectOptions: { procLocksContent: null },
    });
    cleanups.unshift(() => source.stop());

    return { tmp, presenceDir, brainDir, dbPath, accounts, office, source, now };
  }

  it('boots, registers account, and adds active agent from presence and db', async () => {
    const { presenceDir, brainDir, dbPath, office, source } = setupTestEnv();

    const convId = 'sess-main-1';
    // Create active lock
    writeFileSync(join(presenceDir, `${convId}.lock`), '');

    // Add session to sqlite
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO conversation_summaries VALUES (
        '${convId}', 'Main Project Task', 'Preview', 2, '2026-11-05 12:00:00',
        '["file:///home/inok/test-proj"]', 'active', '', 'Antigravity', 1
      );
    `);
    db.close();

    // Create transcript
    const logDir = join(brainDir, convId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      join(logDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: 'Mulai buat aplikasi',
      }) + '\n',
    );

    await source.start();

    const agents = office.list();
    expect(agents.length).toBe(1);
    const agent = agents[0]!;
    expect(agent.id).toBe(`antigravity:${convId}`);
    expect(agent.provider).toBe('antigravity');
    expect(agent.roomId).toBe('/home/inok/test-proj');
    expect(agent.role).toBe('Main Project Task');
    expect(agent.title).toBe('Main Project Task');
    expect(agent.status).toBe('working');

    // Check transcript path
    expect(source.transcriptPathOf(agent.id)).toBe(join(logDir, 'transcript.jsonl'));
  });

  it('detects subagent and associates with parent agent', async () => {
    const { presenceDir, brainDir, dbPath, office, source } = setupTestEnv();

    const parentId = 'main-sess';
    const subId = 'sub-sess';

    writeFileSync(join(presenceDir, `${parentId}.lock`), '');
    writeFileSync(join(presenceDir, `${subId}.lock`), '');

    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO conversation_summaries VALUES
      ('${parentId}', 'Parent Task', '', 1, '2026-11-05 12:00:00', '["file:///home/inok/test-proj"]', 'active', '', 'Antigravity', 1),
      ('${subId}', 'Child Subagent', '', 1, '2026-11-05 12:01:00', '["file:///home/inok/test-proj"]', 'active', '${parentId}', 'Code Researcher', 1);
    `);
    db.close();

    mkdirSync(join(brainDir, parentId, '.system_generated', 'logs'), { recursive: true });
    writeFileSync(join(brainDir, parentId, '.system_generated', 'logs', 'transcript.jsonl'), '');

    mkdirSync(join(brainDir, subId, '.system_generated', 'logs'), { recursive: true });
    writeFileSync(join(brainDir, subId, '.system_generated', 'logs', 'transcript.jsonl'), '');

    await source.start();

    const agents = office.list();
    expect(agents.length).toBe(2);

    const main = agents.find((a) => a.id === `antigravity:${parentId}`);
    const sub = agents.find((a) => a.id === `antigravity:${subId}`);

    expect(main).toBeDefined();
    expect(sub).toBeDefined();
    expect(sub?.kind).toBe('sub');
    expect(sub?.parentId).toBe(`antigravity:${parentId}`);
  });

  it('updates status and activity on new transcript lines and marks offline on close', async () => {
    const { presenceDir, brainDir, dbPath, office, source } = setupTestEnv();

    const convId = 'sess-dynamic';
    const lockPath = join(presenceDir, `${convId}.lock`);
    writeFileSync(lockPath, '');

    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO conversation_summaries VALUES
      ('${convId}', 'Dynamic Task', '', 1, '2026-11-05 12:00:00', '["file:///home/inok/test-proj"]', 'active', '', 'Antigravity', 1);
    `);
    db.close();

    const logDir = join(brainDir, convId, '.system_generated', 'logs');
    mkdirSync(logDir, { recursive: true });
    const transPath = join(logDir, 'transcript.jsonl');
    writeFileSync(transPath, '');

    await source.start();

    const agent = office.list().find((a) => a.id === `antigravity:${convId}`)!;
    expect(agent).toBeDefined();

    // Append ask_question tool call
    writeFileSync(
      transPath,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{ name: 'ask_question', args: {} }],
      }) + '\n',
    );

    // Trigger sync
    (source as unknown as { syncSessions: () => void }).syncSessions();

    expect(agent.status).toBe('waiting');
    expect(agent.waitingFor).toBe('Question');

    // Remove lock file (session closed)
    rmSync(lockPath);
    (source as unknown as { syncSessions: () => void }).syncSessions();

    expect(agent.status).toBe('offline');
  });
});

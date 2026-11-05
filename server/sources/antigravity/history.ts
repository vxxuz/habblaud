import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Provider, RecentSession } from '../../../shared/types';
import type { HistoryProvider, HistoryResolveResult, HistorySession } from '../source';
import { createTerminalParser } from '../terminal';
import { listRecentSessions, openAntigravityDb } from './database';
import { getAntigravityHome } from './detector';

export interface AntigravityHistoryOptions {
  antigravityDir?: string;
  accountId?: string;
  openAgentOf?: (account: string, sessionId: string) => string | undefined;
  limit?: number;
}

export class AntigravityHistory implements HistoryProvider {
  readonly provider: Provider = 'antigravity';

  private readonly antigravityDir: string;
  private readonly brainDir: string;
  private readonly dbPath: string;
  private readonly accountId: string;
  private readonly openAgentOf?: (account: string, sessionId: string) => string | undefined;
  private readonly limit: number;
  private db?: DatabaseSync;

  constructor(opts: AntigravityHistoryOptions = {}) {
    this.antigravityDir = opts.antigravityDir ?? getAntigravityHome();
    this.brainDir = join(this.antigravityDir, 'brain');
    this.dbPath = join(this.antigravityDir, 'conversation_summaries.db');
    this.accountId = opts.accountId ?? 'antigravity:default';
    this.openAgentOf = opts.openAgentOf;
    this.limit = opts.limit ?? 50;
  }

  hasAccount(account: string): boolean {
    return account === this.accountId;
  }

  private getDb(): DatabaseSync | undefined {
    if (!this.db && existsSync(this.dbPath)) {
      this.db = openAntigravityDb(this.dbPath);
    }
    return this.db;
  }

  async list(): Promise<RecentSession[]> {
    const db = this.getDb();
    if (!db) return [];

    const summaries = listRecentSessions(db, this.limit);
    const sessions: RecentSession[] = [];

    for (const s of summaries) {
      if (s.parentId) continue; // skip subagents from main session list

      const transPath = join(this.brainDir, s.id, '.system_generated', 'logs', 'transcript.jsonl');
      let size = 0;
      let lastAt = Date.now();
      try {
        const st = statSync(transPath);
        size = st.size;
        lastAt = st.mtimeMs;
      } catch {
        if (s.lastModifiedTime) {
          lastAt = new Date(s.lastModifiedTime).getTime() || Date.now();
        }
      }

      const isOpen = this.openAgentOf ? this.openAgentOf(this.accountId, s.id) !== undefined : false;

      sessions.push({
        account: this.accountId,
        provider: 'antigravity',
        sessionId: s.id,
        project: s.cwd,
        projectDir: basename(s.cwd),
        title: s.title || 'Antigravity Session',
        lastAt,
        open: isOpen,
        size,
      });
    }

    return sessions;
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    if (!this.hasAccount(account)) {
      return { status: 404, error: 'unknown account' };
    }

    const transcriptPath = join(this.brainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(transcriptPath)) {
      return { status: 404, error: 'session not found' };
    }

    const session: HistorySession = {
      path: transcriptPath,
      createParser: () => createTerminalParser(),
    };
    return session;
  }
}

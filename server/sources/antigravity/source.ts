import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentStatus, Provider, SourceInfo } from '../../../shared/types';
import type { AccountsService } from '../../accounts/service';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';
import { FileTail } from '../tail';
import {
  getSessionMetadata,
  openAntigravityDb,
  type AntigravitySessionMeta,
} from './database';
import {
  detectActiveLocks,
  getAntigravityHome,
  type DetectOptions,
} from './detector';
import {
  createAntigravitySessionState,
  parseTranscriptLine,
  type AntigravitySessionState,
} from './transcript';
import { ArtifactScanner } from './artifacts';

export interface AntigravitySourceOptions {
  accounts: AccountsService;
  office: Office;
  antigravityDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  pollMs?: number;
  detectOptions?: DetectOptions;
}

interface TrackedSession {
  convId: string;
  agentId: string;
  meta: AntigravitySessionMeta;
  state: AntigravitySessionState;
  tail?: FileTail;
  transcriptPath: string;
  inOffice: boolean;
  status: AgentStatus;
  waitingFor?: string;
}

export class AntigravitySource implements AgentSource {
  readonly provider: Provider = 'antigravity';

  private readonly accounts: AccountsService;
  private readonly office: Office;
  private readonly antigravityDir: string;
  private readonly presenceDir: string;
  private readonly brainDir: string;
  private readonly dbPath: string;
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly detectOptions?: DetectOptions;

  private accountId = 'antigravity:default';
  private timer?: NodeJS.Timeout;
  private db?: DatabaseSync;
  private readonly sessions = new Map<string, TrackedSession>();
  private readonly artifactScanner: ArtifactScanner;

  constructor(opts: AntigravitySourceOptions) {
    this.accounts = opts.accounts;
    this.office = opts.office;
    this.antigravityDir = opts.antigravityDir ?? getAntigravityHome(opts.env);
    this.presenceDir = join(this.antigravityDir, 'presence');
    this.brainDir = join(this.antigravityDir, 'brain');
    this.dbPath = join(this.antigravityDir, 'conversation_summaries.db');
    this.now = opts.now ?? Date.now;
    this.pollMs = opts.pollMs ?? 1000;
    this.detectOptions = opts.detectOptions;
    this.artifactScanner = new ArtifactScanner({ approvalsPath: join(this.antigravityDir, 'approved_artifacts.json') });
  }

  async start(): Promise<void> {
    const accEntries = this.accounts.setProviderAccounts('antigravity', [
      {
        dir: this.antigravityDir,
        detected: {
          id: this.accountId,
          provider: 'antigravity',
          configDir: this.antigravityDir,
          short: 'AG',
          name: 'Antigravity CLI',
          color: '#4aa8e8',
        },
      },
    ]);
    if (accEntries[0]) this.accountId = accEntries[0].id;

    this.office.beginBoot();
    try {
      this.syncSessions();
    } finally {
      this.office.endBoot();
    }

    this.timer = setInterval(() => {
      this.syncSessions();
    }, this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.sessions.clear();
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = undefined;
    }
  }

  sources(): SourceInfo[] {
    let openCount = 0;
    for (const s of this.sessions.values()) {
      if (s.inOffice && s.status !== 'offline') openCount++;
    }
    return [
      {
        label: this.accountId,
        provider: 'antigravity',
        path: this.antigravityDir,
        sessions: openCount,
        ok: true,
      },
    ];
  }

  transcriptPathOf(agentId: string): string | undefined {
    const s = this.sessions.get(agentId);
    if (s && existsSync(s.transcriptPath)) return s.transcriptPath;
    const convId = agentId.replace(/^antigravity:/, '');
    const candidate = join(this.brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    return existsSync(candidate) ? candidate : undefined;
  }

  private getDb(): DatabaseSync | undefined {
    if (!this.db && existsSync(this.dbPath)) {
      this.db = openAntigravityDb(this.dbPath);
    }
    return this.db;
  }

  private syncSessions(): void {
    const activeConvIds = new Set(detectActiveLocks(this.presenceDir, this.detectOptions));
    const db = this.getDb();

    // 1. Process active conversations
    for (const convId of activeConvIds) {
      const agentId = `antigravity:${convId}`;
      let s = this.sessions.get(agentId);

      if (!s) {
        const meta = (db && getSessionMetadata(db, convId)) ?? {
          id: convId,
          title: 'Antigravity Session',
          preview: '',
          stepCount: 0,
          lastModifiedTime: '',
          cwd: process.cwd(),
          status: 'active',
          agentName: 'Antigravity',
          notFullyIdle: true,
        };

        const transcriptPath = join(this.brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
        const state = createAntigravitySessionState(convId);
        const tail = existsSync(transcriptPath) ? new FileTail(transcriptPath) : undefined;

        s = {
          convId,
          agentId,
          meta,
          state,
          tail,
          transcriptPath,
          inOffice: false,
          status: 'idle',
        };
        this.sessions.set(agentId, s);
      } else if (db && !s.meta.parentId) {
        // Refresh meta if needed
        const fresh = getSessionMetadata(db, convId);
        if (fresh) s.meta = fresh;
      }

      // Check if tail needs initialization
      if (!s.tail && existsSync(s.transcriptPath)) {
        s.tail = new FileTail(s.transcriptPath);
      }

      // Read new transcript lines
      if (s.tail) {
        const read = s.tail.read();
        for (const line of read.lines) {
          const act = parseTranscriptLine(line, s.state);
          if (act && s.inOffice) {
            this.office.addActivity(s.agentId, act, true);
          }
        }
      }

      // Determine status from transcript state or DB fallback
      let resolvedStatus: AgentStatus = s.state.status;
      if (s.state.stepCount === 0 && s.meta.notFullyIdle) {
        resolvedStatus = 'working';
      }

      s.status = resolvedStatus;
      s.waitingFor = s.state.waitingFor;

      // Ensure agent is in the office
      if (!s.inOffice) {
        if (s.meta.parentId) {
          const parentAgentId = `antigravity:${s.meta.parentId}`;
          const parentInOffice = this.office.list().some((a) => a.id === parentAgentId);
          if (parentInOffice) {
            const added = this.office.addSub({
              id: s.agentId,
              parentId: parentAgentId,
              sessionId: s.convId,
              role: s.meta.agentName || 'Subagent',
              title: s.meta.title,
              background: false,
              startedAt: this.now(),
            });
            if (added) {
              s.inOffice = true;
              this.office.setStatus(s.agentId, s.status, s.waitingFor);
              if (s.state.latestActivity) {
                this.office.addActivity(s.agentId, s.state.latestActivity, true);
              }
            }
          }
        } else {
          this.office.addMain({
            id: s.agentId,
            provider: 'antigravity',
            account: this.accountId,
            sessionId: s.convId,
            cwd: s.meta.cwd,
            role: 'Antigravity CLI',
            startedAt: this.now(),
            status: s.status,
            waitingFor: s.waitingFor,
          });
          s.inOffice = true;
          if (s.state.latestActivity) {
            this.office.addActivity(s.agentId, s.state.latestActivity, true);
          }
        }
      } else {
        this.office.setStatus(s.agentId, s.status, s.waitingFor);
      }

      // Check for pending artifacts requiring CEO approval
      const sessionBrainDir = join(this.brainDir, s.convId);
      const pending = this.artifactScanner.scanSession(s.convId, sessionBrainDir);
      this.office.setPendingArtifact(s.agentId, pending);
    }

    // 2. Mark removed sessions as offline
    for (const [agentId, s] of this.sessions.entries()) {
      if (!activeConvIds.has(s.convId)) {
        if (s.inOffice && s.status !== 'offline') {
          this.office.setStatus(agentId, 'offline');
          s.status = 'offline';
        }
        this.sessions.delete(agentId);
      }
    }
  }
}

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export interface AntigravitySessionMeta {
  id: string;
  title: string;
  preview: string;
  stepCount: number;
  lastModifiedTime: string;
  cwd: string;
  status: string;
  parentId?: string;
  agentName: string;
  notFullyIdle: boolean;
}

export function parseWorkspaceUris(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const results: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') {
        if (item.startsWith('file://')) {
          try {
            results.push(fileURLToPath(item));
          } catch {
            results.push(item.replace(/^file:\/\//, ''));
          }
        } else if (item.startsWith('/')) {
          results.push(item);
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function openAntigravityDb(dbPath: string): DatabaseSync | undefined {
  if (!existsSync(dbPath)) return undefined;
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return undefined;
  }
}

interface RawSummaryRow {
  conversation_id: string;
  title: string;
  preview: string;
  step_count: number;
  last_modified_time: string;
  workspace_uris: string;
  status: string;
  parent_conversation_id: string;
  agent_name: string;
  not_fully_idle: number;
}

function mapRowToMeta(row: unknown): AntigravitySessionMeta | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const r = row as RawSummaryRow;
  const uris = parseWorkspaceUris(r.workspace_uris);
  const cwd = uris[0] || process.cwd();
  const parent = r.parent_conversation_id?.trim();

  return {
    id: r.conversation_id,
    title: r.title || 'Antigravity Session',
    preview: r.preview || '',
    stepCount: Number(r.step_count) || 0,
    lastModifiedTime: r.last_modified_time || '',
    cwd,
    status: r.status || '',
    parentId: parent ? parent : undefined,
    agentName: r.agent_name || (parent ? 'Subagent' : 'Antigravity'),
    notFullyIdle: Boolean(r.not_fully_idle),
  };
}

export function getSessionMetadata(db: DatabaseSync, conversationId: string): AntigravitySessionMeta | undefined {
  try {
    const stmt = db.prepare(`
      SELECT conversation_id, title, preview, step_count, last_modified_time,
             workspace_uris, status, parent_conversation_id, agent_name, not_fully_idle
      FROM conversation_summaries
      WHERE conversation_id = ?
      LIMIT 1
    `);
    const row = stmt.get(conversationId);
    return mapRowToMeta(row);
  } catch {
    return undefined;
  }
}

export function listRecentSessions(db: DatabaseSync, limit = 50): AntigravitySessionMeta[] {
  try {
    const stmt = db.prepare(`
      SELECT conversation_id, title, preview, step_count, last_modified_time,
             workspace_uris, status, parent_conversation_id, agent_name, not_fully_idle
      FROM conversation_summaries
      ORDER BY last_modified_time DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    const results: AntigravitySessionMeta[] = [];
    for (const r of rows) {
      const meta = mapRowToMeta(r);
      if (meta) results.push(meta);
    }
    return results;
  } catch {
    return [];
  }
}

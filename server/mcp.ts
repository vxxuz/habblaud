// Servidor MCP (Model Context Protocol) via stdio para o Habblaud.
// Quando o Antigravity abre, ele inicia este processo MCP automaticamente via ~/.gemini/config/mcp_config.json.
// Ao iniciar (e a cada chamada de ferramenta), garante que o servidor web do Habblaud (http://127.0.0.1:4747)
// esteja rodando em background (detached) sem poluir o stdout do protocolo JSON-RPC.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = process.env.HABBLAUD_HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.HABBLAUD_PORT || 4747);
const HABBLAUD_DIR = path.join(os.homedir(), '.habblaud');
const PID_FILE = path.join(HABBLAUD_DIR, 'server.pid');
const LOG_FILE = path.join(HABBLAUD_DIR, 'server.log');
const LOCK_FILE = path.join(HABBLAUD_DIR, 'autostart.lock');

function resolveServerEntry(): string {
  const selfPath = fileURLToPath(import.meta.url);
  const dir = path.dirname(selfPath);
  const candidate = path.resolve(dir, 'index.js');
  if (fs.existsSync(candidate)) return candidate;
  return path.resolve('/home/inok/habblaud/dist/server/index.js');
}

function resolveProjectRoot(): string {
  const entry = resolveServerEntry();
  return path.resolve(path.dirname(entry), '..', '..');
}

export function fetchSnapshot(host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 1200): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: host,
        port,
        path: '/api/snapshot',
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
            resolve(parsed);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function acquireLock(): boolean {
  try {
    fs.mkdirSync(HABBLAUD_DIR, { recursive: true });
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs < 8000) return false;
      fs.unlinkSync(LOCK_FILE);
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

export async function ensureHabblaudRunning(): Promise<{ running: boolean; startedNow: boolean; url: string; pid?: number }> {
  const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const existing = await fetchSnapshot();
  if (existing) {
    return { running: true, startedNow: false, url };
  }

  const gotLock = acquireLock();
  try {
    if (gotLock) {
      fs.mkdirSync(HABBLAUD_DIR, { recursive: true });
      const logFd = fs.openSync(LOG_FILE, 'a');
      const entry = resolveServerEntry();
      const cwd = resolveProjectRoot();
      const child = spawn(process.execPath, [entry], {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      });
      child.unref();
      try {
        fs.closeSync(logFd);
      } catch {
        // ignore
      }
      if (child.pid) {
        fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
      }
    }

    for (let i = 0; i < 25; i++) {
      await sleep(150);
      const snap = await fetchSnapshot();
      if (snap) {
        let pid: number | undefined;
        try {
          pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()) || undefined;
        } catch {
          // ignore
        }
        return { running: true, startedNow: gotLock, url, pid };
      }
    }
  } finally {
    if (gotLock) releaseLock();
  }

  return { running: false, startedNow: false, url };
}

export async function restartHabblaudServer(): Promise<{ running: boolean; url: string; pid?: number }> {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  await sleep(400);
  const res = await ensureHabblaudRunning();
  return { running: res.running, url: res.url, pid: res.pid };
}

export const MCP_TOOLS = [
  {
    name: 'habblaud_status',
    description:
      'Ensure the Habblaud virtual office server (http://127.0.0.1:4747) is running and return active rooms, agents, and pending CEO approvals.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'habblaud_pending_approvals',
    description:
      'List all plan/design artifacts currently awaiting CEO approval in the Habblaud Executive Suite.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'habblaud_restart_server',
    description:
      'Restart the background Habblaud web server on port 4747 (e.g. after rebuilding client/server bundles).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export async function handleMcpRequest(msg: {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const { id, method, params } = msg;
  if (!method) return null;

  // Notifications (no id) do not expect a response
  if (id === undefined) {
    if (method === 'notifications/initialized') {
      void ensureHabblaudRunning();
    }
    return null;
  }

  switch (method) {
    case 'initialize': {
      const requestedVersion =
        typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
      void ensureHabblaudRunning();
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requestedVersion,
          serverInfo: {
            name: 'habblaud-mcp',
            version: '1.0.3',
          },
          capabilities: {
            tools: { listChanged: false },
          },
          instructions:
            'Habblaud virtual office MCP server. Automatically starts http://127.0.0.1:4747 when Antigravity launches.',
        },
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };

    case 'prompts/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { prompts: [] },
      };

    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { resources: [] },
      };

    case 'tools/call': {
      const toolName = typeof params?.name === 'string' ? params.name : '';
      if (toolName === 'habblaud_status') {
        const state = await ensureHabblaudRunning();
        const snap = await fetchSnapshot();
        const agents = Array.isArray(snap?.agents) ? (snap.agents as Record<string, unknown>[]) : [];
        const rooms = Array.isArray(snap?.rooms) ? (snap.rooms as Record<string, unknown>[]) : [];
        const pendingApprovals = agents
          .filter((a) => !!a.pendingArtifact)
          .map((a) => ({
            agentId: a.id,
            agentName: a.name,
            artifact: a.pendingArtifact,
          }));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ...state,
                    roomsCount: rooms.length,
                    agentsCount: agents.length,
                    agents: agents.map((a) => ({
                      id: a.id,
                      name: a.name,
                      status: a.status,
                      provider: a.provider,
                      project: a.project,
                      pendingArtifact: a.pendingArtifact ?? null,
                    })),
                    pendingApprovals,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        };
      }

      if (toolName === 'habblaud_pending_approvals') {
        await ensureHabblaudRunning();
        const snap = await fetchSnapshot();
        const agents = Array.isArray(snap?.agents) ? (snap.agents as Record<string, unknown>[]) : [];
        const pendingApprovals = agents
          .filter((a) => !!a.pendingArtifact)
          .map((a) => ({
            agentId: a.id,
            agentName: a.name,
            project: a.project,
            artifact: a.pendingArtifact,
          }));
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ count: pendingApprovals.length, pendingApprovals }, null, 2),
              },
            ],
          },
        };
      }

      if (toolName === 'habblaud_restart_server') {
        const res = await restartHabblaudServer();
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(res, null, 2),
              },
            ],
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${toolName}`,
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}

export function startMcpStdio(): void {
  // Garante imediatamente ao abrir o Antigravity que o servidor web 4747 suba em background
  void ensureHabblaudRunning();

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed) as {
        jsonrpc?: string;
        id?: string | number | null;
        method?: string;
        params?: Record<string, unknown>;
      };
      const resp = await handleMcpRequest(msg);
      if (resp) {
        process.stdout.write(JSON.stringify(resp) + '\n');
      }
    } catch {
      // Ignore malformed lines on stdin
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('habblaud-mcp') || process.argv[1]?.endsWith('mcp.js')) {
  startMcpStdio();
}

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Office } from '../model/office';

export interface McpToolSchema {
  name: string;
  description: string;
}

export interface McpServerSummary {
  name: string;
  command: string;
  args: string[];
  installed: boolean;
  toolCount: number;
  tools: McpToolSchema[];
}

export interface CodebaseMemoryProject {
  name: string;
  rootPath: string;
  branch: string;
}

export interface McpActivityItem {
  id: string;
  agentId: string;
  agentName: string;
  text: string;
  at: number;
}

export interface McpStatusSnapshot {
  configPath: string;
  servers: McpServerSummary[];
  codebaseMemory: {
    available: boolean;
    binaryPath?: string;
    projects: CodebaseMemoryProject[];
    rawOutput?: string;
  };
  recentActivity: McpActivityItem[];
}

interface RawMcpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

const CALL_TIMEOUT_MS = 15_000;

export class McpControlService {
  private readonly home: string;
  private readonly office: Office;
  private cachedProjects: CodebaseMemoryProject[] = [];
  private lastProjectsFetch = 0;

  constructor(opts: { office: Office; home?: string }) {
    this.office = opts.office;
    this.home = opts.home ?? homedir();
  }

  private get configPath(): string {
    return join(this.home, '.gemini', 'config', 'mcp_config.json');
  }

  private get schemasRoot(): string {
    return join(this.home, '.gemini', 'antigravity-cli', 'mcp');
  }

  readServers(): McpServerSummary[] {
    const out: McpServerSummary[] = [];
    const seen = new Set<string>();

    let cfg: RawMcpConfig = {};
    if (existsSync(this.configPath)) {
      try {
        cfg = JSON.parse(readFileSync(this.configPath, 'utf8')) as RawMcpConfig;
      } catch {
        cfg = {};
      }
    }

    const servers = cfg.mcpServers ?? {};
    for (const [name, def] of Object.entries(servers)) {
      seen.add(name);
      const command = typeof def?.command === 'string' ? def.command : name;
      const args = Array.isArray(def?.args) ? def.args.filter((a): a is string => typeof a === 'string') : [];
      const installed = command.startsWith('/') ? existsSync(command) : true;
      const tools = this.readServerTools(name);
      out.push({
        name,
        command,
        args,
        installed,
        toolCount: tools.length,
        tools,
      });
    }

    // Also include any discovered MCP schema directories not in mcp_config.json
    if (existsSync(this.schemasRoot)) {
      try {
        for (const entry of readdirSync(this.schemasRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || seen.has(entry.name)) continue;
          const tools = this.readServerTools(entry.name);
          out.push({
            name: entry.name,
            command: entry.name,
            args: [],
            installed: true,
            toolCount: tools.length,
            tools,
          });
        }
      } catch {
        // ignore
      }
    }

    return out;
  }

  private readServerTools(serverName: string): McpToolSchema[] {
    const dir = join(this.schemasRoot, serverName);
    if (!existsSync(dir)) return [];
    const tools: McpToolSchema[] = [];
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const full = join(dir, file);
        try {
          const raw = JSON.parse(readFileSync(full, 'utf8')) as { name?: string; description?: string };
          const name = typeof raw.name === 'string' ? raw.name : file.replace(/\.json$/, '');
          const desc = typeof raw.description === 'string' ? raw.description.split('\n')[0]!.trim() : '';
          tools.push({ name, description: desc });
        } catch {
          // ignore malformed schema
        }
      }
    } catch {
      // ignore
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveCodebaseMemoryBin(servers = this.readServers()): string | undefined {
    const entry = servers.find((s) => s.name === 'codebase-memory-mcp');
    if (entry?.command && existsSync(entry.command)) return entry.command;
    const fallback = join(this.home, '.local', 'bin', 'codebase-memory-mcp');
    return existsSync(fallback) ? fallback : undefined;
  }

  async callCodebaseMemoryTool(toolName: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; text: string }> {
    const bin = this.resolveCodebaseMemoryBin();
    if (!bin) {
      return { ok: false, text: 'codebase-memory-mcp binary not found' };
    }

    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(bin, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      const finish = (ok: boolean, text: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve({ ok, text });
      };

      const timer = setTimeout(() => {
        finish(false, `Timed out waiting for codebase-memory-mcp (${toolName})`);
      }, CALL_TIMEOUT_MS);

      let buf = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buf += chunk;
        let idx = buf.indexOf('\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          idx = buf.indexOf('\n');
          if (!line.startsWith('{')) continue;
          try {
            const msg = JSON.parse(line) as {
              id?: number;
              result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
              error?: { message?: string };
            };
            if (msg.id === 2) {
              if (msg.error) {
                finish(false, msg.error.message ?? 'MCP error');
                return;
              }
              const text = (msg.result?.content ?? [])
                .map((c) => (typeof c.text === 'string' ? c.text : ''))
                .filter(Boolean)
                .join('\n');
              finish(!msg.result?.isError, text || 'OK');
              return;
            }
          } catch {
            // continue reading
          }
        }
      });

      child.on('error', (err) => finish(false, err.message));
      child.on('close', () => finish(false, 'MCP server exited before responding'));

      const initMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'habblaud-mcp-room', version: '1.0.3' },
        },
      });
      const initializedNotif = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      const callMsg = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      });

      child.stdin.write(`${initMsg}\n${initializedNotif}\n${callMsg}\n`);
    });
  }

  parseProjectsOutput(raw: string): CodebaseMemoryProject[] {
    const lines = raw.split('\n');
    const projects: CodebaseMemoryProject[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('projects:') || trimmed.startsWith('total:') || trimmed.startsWith('returned:') || trimmed.startsWith('has_more:')) {
        continue;
      }
      // Match: <name> "<root_path>" <branch> OR <name> <root_path> <branch>
      const quoted = /^(\S+)\s+"([^"]+)"\s+(\S+)$/.exec(trimmed);
      if (quoted) {
        projects.push({ name: quoted[1]!, rootPath: quoted[2]!, branch: quoted[3]! });
        continue;
      }
      const plain = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(trimmed);
      if (plain) {
        projects.push({ name: plain[1]!, rootPath: plain[2]!, branch: plain[3]! });
      }
    }
    return projects;
  }

  async getStatus(forceRefresh = false): Promise<McpStatusSnapshot> {
    const servers = this.readServers();
    const bin = this.resolveCodebaseMemoryBin(servers);
    let rawOutput: string | undefined;

    if (bin && (forceRefresh || Date.now() - this.lastProjectsFetch > 10_000 || this.cachedProjects.length === 0)) {
      const res = await this.callCodebaseMemoryTool('list_projects', {});
      if (res.ok) {
        rawOutput = res.text;
        this.cachedProjects = this.parseProjectsOutput(res.text);
        this.lastProjectsFetch = Date.now();
      }
    }

    const recentActivity: McpActivityItem[] = [];
    for (const agent of this.office.list()) {
      for (const act of agent.recent ?? []) {
        if (act.kind === 'mcp' || act.text.toLowerCase().includes('mcp')) {
          recentActivity.push({
            id: `${agent.id}:${act.id}`,
            agentId: agent.id,
            agentName: agent.name,
            text: act.text,
            at: act.at,
          });
        }
      }
    }
    recentActivity.sort((a, b) => b.at - a.at);

    return {
      configPath: this.configPath,
      servers,
      codebaseMemory: {
        available: !!bin,
        binaryPath: bin,
        projects: this.cachedProjects,
        rawOutput,
      },
      recentActivity: recentActivity.slice(0, 25),
    };
  }

  async indexRepository(repoPath: string): Promise<{ ok: boolean; text: string; projects: CodebaseMemoryProject[] }> {
    const res = await this.callCodebaseMemoryTool('index_repository', { repo_path: repoPath });
    const listRes = await this.callCodebaseMemoryTool('list_projects', {});
    if (listRes.ok) {
      this.cachedProjects = this.parseProjectsOutput(listRes.text);
      this.lastProjectsFetch = Date.now();
    }
    return {
      ok: res.ok,
      text: res.text,
      projects: this.cachedProjects,
    };
  }

  async searchGraph(project: string, query: string): Promise<{ ok: boolean; text: string }> {
    const args: Record<string, unknown> = {
      name_pattern: query.trim() || '.*',
    };
    if (project.trim()) {
      args.project = project.trim();
    }
    return this.callCodebaseMemoryTool('search_graph', args);
  }
}

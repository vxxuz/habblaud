import type { UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';

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

export const MCP_SERVER_ROOM_ID = 'core:boardroom';

export class McpServerView {
  readonly el: HTMLElement;
  private statusMsg: HTMLElement;
  private serversWrap: HTMLElement;
  private serversCount: HTMLElement;
  private cbmStatusBadge: HTMLElement;
  private projectsWrap: HTMLElement;
  private projectsCount: HTMLElement;
  private repoInput: HTMLInputElement;
  private indexBtn: HTMLButtonElement;
  private indexOutput: HTMLElement;
  private projectSelect: HTMLSelectElement;
  private searchInput: HTMLInputElement;
  private searchBtn: HTMLButtonElement;
  private searchOutput: HTMLElement;
  private activityWrap: HTMLElement;
  private activityEmpty: HTMLElement;
  private loading = false;
  private data: McpStatusSnapshot | null = null;
  private lastFetchAt = 0;

  constructor(private ctx: UiContext) {
    const swatch = h('span', { class: 'ui-room-swatch', attrs: { style: '--room: #38bdf8' } });
    const title = h('h2', { class: 'ui-hero__name', text: 'MCP Server Room' });
    const sub = h('span', { class: 'ui-mono ui-muted ui-small', text: '~/.gemini/config/mcp_config.json' });

    const refreshBtn = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: 'Refresh',
      on: { click: () => void this.load(true) },
    }) as HTMLButtonElement;

    const centerBtn = iconButton(
      ICONS.target,
      'Center camera on MCP Server Room',
      () => ctx.world.focusRoom(MCP_SERVER_ROOM_ID),
      'ui-icon-btn--sm',
    );

    this.statusMsg = h('p', { class: 'ui-muted ui-small', hidden: true });

    // 1. Connected MCP Servers section
    this.serversCount = h('span', { class: 'ui-sec__extra', text: '0' });
    this.serversWrap = h('div', { class: 'ui-mcp-servers' });
    const serversSec = h(
      'section',
      { class: 'ui-sec' },
      h('header', { class: 'ui-sec__head' }, h('h3', { class: 'ui-sec__title', text: 'Connected MCP Servers' }), this.serversCount),
      this.serversWrap,
    );

    // 2. Codebase Memory Graph section
    this.cbmStatusBadge = h('span', { class: 'ui-sec__extra', text: 'checking…' });
    this.projectsCount = h('span', { class: 'ui-muted ui-small' });
    this.projectsWrap = h('div', { class: 'ui-mcp-projects' });

    this.repoInput = h('input', {
      class: 'ui-search__input',
      type: 'text',
      attrs: {
        placeholder: '/home/inok/habblaud (path to index)',
        value: '/home/inok/habblaud',
        style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: inherit; font-size: 12px;',
      },
    });
    this.indexBtn = h('button', {
      class: 'ui-btn ui-btn--sm ui-btn--accent',
      type: 'button',
      text: 'Index Repo',
      on: { click: () => void this.runIndex(this.repoInput.value) },
    }) as HTMLButtonElement;
    this.indexOutput = h('pre', {
      class: 'ui-mono ui-small',
      hidden: true,
      attrs: {
        style: 'margin-top: 6px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.35); max-height: 140px; overflow: auto; white-space: pre-wrap; font-size: 11px;',
      },
    });

    this.projectSelect = h('select', {
      attrs: {
        style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(15,23,42,0.9); color: inherit; font-size: 12px; margin-bottom: 6px;',
      },
    }) as HTMLSelectElement;

    this.searchInput = h('input', {
      class: 'ui-search__input',
      type: 'text',
      attrs: {
        placeholder: 'Regex / symbol name (e.g. .*Office.* or .*Mcp.*)',
        value: '.*Mcp.*',
        style: 'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: inherit; font-size: 12px;',
      },
    });
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.runSearch();
      }
    });

    this.searchBtn = h('button', {
      class: 'ui-btn ui-btn--sm ui-btn--accent',
      type: 'button',
      text: 'Search Graph',
      on: { click: () => void this.runSearch() },
    }) as HTMLButtonElement;

    this.searchOutput = h('pre', {
      class: 'ui-mono ui-small',
      hidden: true,
      attrs: {
        style: 'margin-top: 6px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.35); max-height: 200px; overflow: auto; white-space: pre-wrap; font-size: 11px;',
      },
    });

    const cbmSec = h(
      'section',
      { class: 'ui-sec' },
      h('header', { class: 'ui-sec__head' }, h('h3', { class: 'ui-sec__title', text: 'Codebase Memory Graph' }), this.cbmStatusBadge),
      this.projectsCount,
      this.projectsWrap,
      h(
        'div',
        { attrs: { style: 'margin-top: 10px; display: flex; gap: 6px; align-items: center;' } },
        this.repoInput,
        this.indexBtn,
      ),
      this.indexOutput,
      h(
        'div',
        { attrs: { style: 'margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);' } },
        h('div', { class: 'ui-small', text: 'Quick Graph Symbol Search (search_graph)', attrs: { style: 'font-weight: 600; margin-bottom: 6px;' } }),
        this.projectSelect,
        h('div', { attrs: { style: 'display: flex; gap: 6px; align-items: center;' } }, this.searchInput, this.searchBtn),
        this.searchOutput,
      ),
    );

    // 3. Recent MCP Activity section
    this.activityWrap = h('div', { class: 'ui-mcp-activity' });
    this.activityEmpty = h('p', { class: 'ui-muted ui-small', text: 'No recent MCP tool calls recorded yet.' });
    const activitySec = h(
      'section',
      { class: 'ui-sec' },
      h('header', { class: 'ui-sec__head' }, h('h3', { class: 'ui-sec__title', text: 'Live MCP Activity' })),
      this.activityWrap,
      this.activityEmpty,
    );

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-room-view' },
      h(
        'div',
        { class: 'ui-room-hero' },
        swatch,
        h('div', { class: 'ui-hero__text' }, h('div', { class: 'ui-room-hero__title' }, title), sub),
      ),
      h(
        'div',
        { class: 'ui-status' },
        h('span', { class: 'ui-small', text: '🔌 Antigravity MCP Hub' }),
        h('span', { class: 'ui-status__actions' }, refreshBtn, centerBtn),
      ),
      this.statusMsg,
      serversSec,
      cbmSec,
      activitySec,
    );
  }

  open(): void {
    if (!this.data || Date.now() - this.lastFetchAt > 8_000) {
      void this.load(false);
    } else {
      this.renderData();
    }
  }

  render(): void {
    if (!this.data && !this.loading) {
      void this.load(false);
    }
  }

  async load(forceRefresh: boolean): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    setText(this.statusMsg, 'Loading MCP server status…');
    setHidden(this.statusMsg, false);
    try {
      const res = await fetch(`/api/mcp/status${forceRefresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = (await res.json()) as McpStatusSnapshot;
      this.lastFetchAt = Date.now();
      setHidden(this.statusMsg, true);
      this.renderData();
    } catch (err) {
      setText(this.statusMsg, `Failed to load MCP status: ${(err as Error).message}`);
      setHidden(this.statusMsg, false);
    } finally {
      this.loading = false;
    }
  }

  private renderData(): void {
    const d = this.data;
    if (!d) return;

    // 1. Render MCP servers
    setText(this.serversCount, String(d.servers.length));
    this.serversWrap.replaceChildren(
      ...d.servers.map((srv) => {
        const badge = h('span', {
          class: 'ui-small',
          text: srv.installed ? '● ONLINE' : '○ MISSING',
          attrs: {
            style: `color: ${srv.installed ? '#4ade80' : '#f87171'}; font-weight: 700; font-size: 11px;`,
          },
        });
        const card = h(
          'div',
          {
            attrs: {
              style: 'padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 8px;',
            },
          },
          h(
            'div',
            { attrs: { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px;' } },
            h('strong', { text: srv.name, attrs: { style: 'font-size: 13px;' } }),
            badge,
          ),
          h('div', { class: 'ui-mono ui-muted ui-small', text: srv.command, attrs: { style: 'margin-top: 2px; word-break: break-all;' } }),
          h(
            'details',
            { attrs: { style: 'margin-top: 6px;' } },
            h('summary', {
              class: 'ui-small',
              text: `${srv.toolCount} registered tools`,
              attrs: { style: 'cursor: pointer; color: #38bdf8; user-select: none;' },
            }),
            h(
              'ul',
              { attrs: { style: 'margin: 6px 0 0 0; padding-left: 16px; font-size: 11.5px;' } },
              ...srv.tools.map((t) =>
                h(
                  'li',
                  { attrs: { style: 'margin-bottom: 4px;' } },
                  h('code', { text: t.name, attrs: { style: 'color: #e2e8f0; font-weight: 600;' } }),
                  t.description ? h('span', { class: 'ui-muted', text: ` — ${t.description}` }) : null,
                ),
              ),
            ),
          ),
        );
        return card;
      }),
    );

    // 2. Render Codebase Memory projects
    const cbm = d.codebaseMemory;
    setText(this.cbmStatusBadge, cbm.available ? `${cbm.projects.length} indexed` : 'unavailable');
    setText(this.projectsCount, cbm.available ? `Binary: ${cbm.binaryPath ?? 'codebase-memory-mcp'}` : 'codebase-memory-mcp binary not found');

    const prevProject = this.projectSelect.value;
    this.projectSelect.replaceChildren(
      h('option', { text: 'All Indexed Projects', attrs: { value: '' } }),
      ...cbm.projects.map((p) =>
        h('option', {
          text: `${p.name} (${p.rootPath})`,
          attrs: { value: p.name },
        }),
      ),
    );
    if (prevProject && cbm.projects.some((p) => p.name === prevProject)) {
      this.projectSelect.value = prevProject;
    } else if (cbm.projects.some((p) => p.name === 'home-inok-habblaud')) {
      this.projectSelect.value = 'home-inok-habblaud';
    }

    this.projectsWrap.replaceChildren(
      ...cbm.projects.map((proj) => {
        const reindexBtn = h('button', {
          class: 'ui-btn ui-btn--sm',
          type: 'button',
          text: 'Re-index',
          on: { click: () => void this.runIndex(proj.rootPath) },
        });
        return h(
          'div',
          {
            attrs: {
              style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-top: 6px;',
            },
          },
          h(
            'div',
            { attrs: { style: 'min-width: 0; flex: 1;' } },
            h('div', { text: proj.name, attrs: { style: 'font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis;' } }),
            h('div', { class: 'ui-mono ui-muted ui-small', text: `${proj.rootPath}${proj.branch && proj.branch !== '-' ? ` (${proj.branch})` : ''}`, attrs: { style: 'font-size: 10.5px; overflow: hidden; text-overflow: ellipsis;' } }),
          ),
          reindexBtn,
        );
      }),
    );

    // 3. Render Recent MCP Activity
    const acts = d.recentActivity ?? [];
    setHidden(this.activityEmpty, acts.length > 0);
    this.activityWrap.replaceChildren(
      ...acts.map((act) =>
        h(
          'button',
          {
            type: 'button',
            class: 'ui-link-btn',
            attrs: {
              style: 'display: flex; justify-content: space-between; width: 100%; text-align: left; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-bottom: 4px; text-decoration: none;',
            },
            on: {
              click: () => this.ctx.select({ type: 'agent', id: act.agentId }, { focus: true }),
            },
          },
          h(
            'span',
            { attrs: { style: 'font-size: 12px;' } },
            h('strong', { text: `${act.agentName}: ` }),
            h('span', { text: act.text }),
          ),
          h('span', { class: 'ui-muted ui-small', text: relativeTime(act.at, this.ctx.now()) }),
        ),
      ),
    );
  }

  private async runIndex(repoPath: string): Promise<void> {
    const trimmed = repoPath.trim();
    if (!trimmed) return;
    this.indexBtn.disabled = true;
    setText(this.indexOutput, `Indexing ${trimmed} via codebase-memory-mcp…`);
    setHidden(this.indexOutput, false);
    try {
      const res = await fetch('/api/mcp/codebase-memory/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: trimmed }),
      });
      const body = (await res.json()) as { ok?: boolean; text?: string; error?: string; projects?: CodebaseMemoryProject[] };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setText(this.indexOutput, body.text || 'Indexing complete.');
      if (this.data && body.projects) {
        this.data.codebaseMemory.projects = body.projects;
        this.renderData();
      }
      window.dispatchEvent(new CustomEvent('habblaud:mcp-updated'));
    } catch (err) {
      setText(this.indexOutput, `Error: ${(err as Error).message}`);
    } finally {
      this.indexBtn.disabled = false;
    }
  }

  private async runSearch(): Promise<void> {
    const query = this.searchInput.value.trim();
    if (!query) return;
    const project = this.projectSelect.value;
    this.searchBtn.disabled = true;
    setText(this.searchOutput, `Searching knowledge graph (${project || 'all projects'})…`);
    setHidden(this.searchOutput, false);
    try {
      const res = await fetch('/api/mcp/codebase-memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, query }),
      });
      const body = (await res.json()) as { ok?: boolean; text?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setText(this.searchOutput, body.text || 'No results.');
    } catch (err) {
      setText(this.searchOutput, `Error: ${(err as Error).message}`);
    } finally {
      this.searchBtn.disabled = false;
    }
  }
}

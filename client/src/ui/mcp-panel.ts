import type { UiContext } from './context';
import { copyText, h, iconButton, setAttr, setHidden, setText, setTitle } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';
import { createStatusDot } from './widgets';

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

function copyButton(getText: () => string, label: string): HTMLButtonElement {
  const b = iconButton(
    ICONS.copy,
    label,
    async () => {
      const ok = await copyText(getText());
      b.classList.toggle('is-done', ok);
      b.innerHTML = ok ? ICONS.check : ICONS.copy;
      setTitle(b, ok ? 'Copied!' : 'Failed to copy');
      setTimeout(() => {
        b.classList.remove('is-done');
        b.innerHTML = ICONS.copy;
        setTitle(b, label);
      }, 1400);
    },
    'ui-icon-btn--sm',
  );
  return b;
}

function section(title: string, ...children: (Node | null)[]): { el: HTMLElement; title: HTMLElement; extra: HTMLElement } {
  const t = h('h3', { class: 'ui-sec__title', text: title });
  const extra = h('span', { class: 'ui-sec__extra' });
  const el = h(
    'section',
    { class: 'ui-sec' },
    h('div', { class: 'ui-sec__head' }, t, extra),
    ...children.filter((c): c is Node => !!c),
  );
  return { el, title: t, extra };
}

export class McpServerView {
  readonly el: HTMLElement;
  private statusMsg: HTMLElement;
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private statusSince: HTMLElement;
  private serversWrap: HTMLElement;
  private serversSec: ReturnType<typeof section>;
  private cbmSec: ReturnType<typeof section>;
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
  private activitySec: ReturnType<typeof section>;
  private specsSec: ReturnType<typeof section>;
  private specsDl: HTMLElement;
  private loading = false;
  private data: McpStatusSnapshot | null = null;
  private lastFetchAt = 0;

  constructor(private ctx: UiContext) {
    // 1. Hero Header (styled exactly like Agent detail hero)
    const avatar = h(
      'div',
      {
        class: 'ui-hero__avatar',
        attrs: {
          style:
            'width: 48px; height: 48px; border-radius: 12px; background: radial-gradient(circle at 30% 30%, #1e293b, #0f172a); border: 2px solid #38bdf8; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 16px rgba(56, 189, 248, 0.35); position: relative; flex: none;',
        },
      },
      h('span', { attrs: { style: 'font-size: 24px; user-select: none;' }, text: '🖥️' }),
    );

    const title = h('h2', { class: 'ui-hero__name', text: 'MCP Server Room' });
    const roleBadge = h('span', {
      class: 'ui-role',
      text: 'MCP HOST',
      attrs: {
        style:
          'background: rgba(56, 189, 248, 0.16); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-weight: 700; padding: 2px 7px; border-radius: 4px;',
      },
    });

    const cbmChip = h(
      'span',
      {
        attrs: {
          style:
            'display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); font-weight: 600; font-size: 11px; color: #bae6fd;',
        },
      },
      h('span', { attrs: { style: 'width: 6px; height: 6px; border-radius: 50%; background: #38bdf8;' } }),
      h('span', { text: 'codebase-memory-mcp' }),
    );

    const habChip = h(
      'span',
      {
        attrs: {
          style:
            'display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.25); font-weight: 600; font-size: 11px; color: #a7f3d0;',
        },
      },
      h('span', { attrs: { style: 'width: 6px; height: 6px; border-radius: 50%; background: #34d399;' } }),
      h('span', { text: 'habblaud-mcp' }),
    );

    const heroText = h(
      'div',
      { class: 'ui-hero__text' },
      h('div', { class: 'ui-hero__line' }, title, roleBadge),
      h('div', { class: 'ui-hero__acc', attrs: { style: 'flex-wrap: wrap; gap: 6px;' } }, cbmChip, habChip),
      h(
        'div',
        { class: 'ui-hero__where' },
        h('span', { class: 'ui-muted', text: 'Room' }),
        h(
          'button',
          {
            class: 'ui-room-link',
            type: 'button',
            attrs: { style: 'color: #38bdf8;' },
            on: { click: () => ctx.world.focusRoom(MCP_SERVER_ROOM_ID) },
          },
          'MCP Server Room (South Wing · Col 2)',
        ),
      ),
    );

    const heroTitle = h(
      'p',
      { class: 'ui-hero__title' },
      'Local Model Context Protocol host connecting codebase knowledge graphs and Habblaud management tools. Agents use these servers for graph searches, symbol lookups, and automation.',
    );

    // 2. Status Row (styled exactly like Agent detail status row)
    this.statusDot = createStatusDot();
    this.statusDot.classList.add('is-working');
    this.statusText = h('span', { class: 'ui-status__text', text: 'ONLINE' });
    this.statusSince = h('span', { class: 'ui-status__since', text: 'Port 4747' });

    const refreshBtn = h(
      'button',
      {
        class: 'ui-btn',
        type: 'button',
        title: 'Refresh MCP servers and projects',
        on: { click: () => void this.load(true) },
      },
      h('span', { text: 'Refresh' }),
    ) as HTMLButtonElement;

    const centerBtn = h(
      'button',
      {
        class: 'ui-btn',
        type: 'button',
        title: 'Center camera on MCP Server Room',
        on: { click: () => ctx.world.focusRoom(MCP_SERVER_ROOM_ID) },
      },
      h('span', { attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: 'Centralize' }),
    );
    (centerBtn.firstChild as HTMLElement).innerHTML = ICONS.center;

    const statusRow = h(
      'div',
      { class: 'ui-status' },
      h('span', { class: 'ui-status__label' }, this.statusDot, this.statusText, this.statusSince),
      h('span', { class: 'ui-status__actions' }, refreshBtn, centerBtn),
    );

    // 3. Action Terminal CTA (styled exactly like Agent's "Abrir terminal")
    const termIcon = h('span', { class: 'ui-term-cta__icon', attrs: { 'aria-hidden': 'true' } });
    termIcon.innerHTML = ICONS.terminal;
    const termLabel = h('span', { class: 'ui-term-cta__label', text: 'Graph Symbol Search (search_graph)' });
    const termRo = h('span', { class: 'ui-term-cta__ro', text: 'live' });
    const termBtn = h(
      'button',
      {
        class: 'ui-btn ui-term-cta',
        type: 'button',
        on: {
          click: () => {
            this.searchInput.focus();
            this.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        },
      },
      termIcon,
      termLabel,
      termRo,
      h('kbd', { class: 'ui-kbd', text: 'Q', attrs: { 'aria-hidden': 'true' } }),
    );

    this.statusMsg = h('p', { class: 'ui-muted ui-small', hidden: true });

    // 4. Section: Connected MCP Servers
    this.serversWrap = h('div', { class: 'ui-mcp-servers' });
    this.serversSec = section('Connected MCP Servers', this.serversWrap);

    // 5. Section: Codebase Memory Graph
    this.projectsCount = h('span', { class: 'ui-muted ui-small' });
    this.projectsWrap = h('div', { class: 'ui-mcp-projects' });

    this.repoInput = h('input', {
      class: 'ui-search__input',
      type: 'text',
      attrs: {
        placeholder: '/home/inok/habblaud (path to index)',
        value: '/home/inok/habblaud',
        style:
          'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: inherit; font-size: 12px;',
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
        style:
          'margin-top: 6px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.35); max-height: 140px; overflow: auto; white-space: pre-wrap; font-size: 11px;',
      },
    });

    this.projectSelect = h('select', {
      attrs: {
        style:
          'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(15,23,42,0.9); color: inherit; font-size: 12px; margin-bottom: 6px;',
      },
    }) as HTMLSelectElement;

    this.searchInput = h('input', {
      class: 'ui-search__input',
      type: 'text',
      attrs: {
        placeholder: 'Regex / symbol name (e.g. .*Mcp.* or .*Office.*)',
        value: '.*Mcp.*',
        style:
          'width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25); color: inherit; font-size: 12px;',
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
        style:
          'margin-top: 6px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.35); max-height: 200px; overflow: auto; white-space: pre-wrap; font-size: 11px;',
      },
    });

    this.cbmSec = section(
      'Codebase Memory Graph',
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
        h(
          'div',
          { class: 'ui-small', text: 'Quick Symbol Search (search_graph)', attrs: { style: 'font-weight: 600; margin-bottom: 6px;' } },
        ),
        this.projectSelect,
        h('div', { attrs: { style: 'display: flex; gap: 6px; align-items: center;' } }, this.searchInput, this.searchBtn),
        this.searchOutput,
      ),
    );

    // 6. Section: Live MCP Tool Activity
    this.activityWrap = h('div', { class: 'ui-mcp-activity' });
    this.activityEmpty = h('p', { class: 'ui-muted ui-small', text: 'No recent MCP tool calls recorded yet.' });
    this.activitySec = section('Live MCP Tool Activity', this.activityWrap, this.activityEmpty);

    // 7. Section: Host Specifications (styled like Agent Stats KvList)
    this.specsDl = h('dl', { class: 'ui-kv ui-stats' });
    this.specsSec = section('Server Specifications & Host Info', this.specsDl);

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-agent-view ui-mcp-view' },
      h('div', { class: 'ui-hero' }, avatar, heroText),
      heroTitle,
      statusRow,
      termBtn,
      this.statusMsg,
      this.serversSec.el,
      this.cbmSec.el,
      this.activitySec.el,
      this.specsSec.el,
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

    // Status row update
    const onlineCount = d.servers.filter((s) => s.installed).length;
    setText(this.statusText, `ONLINE · ${onlineCount} Server${onlineCount === 1 ? '' : 's'} Active`);
    setText(this.statusSince, 'Port 4747 (LAN)');

    // 1. Render MCP servers
    setText(this.serversSec.extra, `${d.servers.length} configured`);
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
              style:
                'padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 8px;',
            },
          },
          h(
            'div',
            { attrs: { style: 'display: flex; justify-content: space-between; align-items: center; gap: 8px;' } },
            h('strong', { text: srv.name, attrs: { style: 'font-size: 13px;' } }),
            badge,
          ),
          h(
            'div',
            { attrs: { style: 'display: flex; align-items: center; justify-content: space-between; margin-top: 2px;' } },
            h('span', { class: 'ui-mono ui-muted ui-small', text: srv.command, attrs: { style: 'word-break: break-all;' } }),
            copyButton(() => srv.command, 'Copy binary command'),
          ),
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
    setText(this.cbmSec.extra, cbm.available ? `${cbm.projects.length} indexed` : 'unavailable');
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
              style:
                'display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-top: 6px;',
            },
          },
          h(
            'div',
            { attrs: { style: 'min-width: 0; flex: 1;' } },
            h('div', { text: proj.name, attrs: { style: 'font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis;' } }),
            h('div', {
              class: 'ui-mono ui-muted ui-small',
              text: `${proj.rootPath}${proj.branch && proj.branch !== '-' ? ` (${proj.branch})` : ''}`,
              attrs: { style: 'font-size: 10.5px; overflow: hidden; text-overflow: ellipsis;' },
            }),
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
              style:
                'display: flex; justify-content: space-between; width: 100%; text-align: left; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-bottom: 4px; text-decoration: none;',
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

    // 4. Render Specifications DL
    const totalTools = d.servers.reduce((sum, s) => sum + s.toolCount, 0);
    const specsItems: [string, string, string?][] = [
      ['Config Path', d.configPath],
      ['Protocol', 'JSON-RPC 2.0 (newline-delimited stdio)'],
      ['HTTP Binding', '0.0.0.0:4747 (LAN + localhost)'],
      ['Total Tools', `${totalTools} registered tools across ${d.servers.length} servers`],
      ['Cache Root', '~/.cache/codebase-memory-mcp/'],
    ];

    this.specsDl.replaceChildren(
      ...specsItems.flatMap(([label, value]) => [
        h('dt', { text: label }),
        h('dd', { class: 'ui-mono-inline', text: value }),
      ]),
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

import type { TerminalEntry, TerminalInputKind } from '../../../shared/types';
import { maskSecrets } from '../../../shared/activity';
import {
  INPUT_MAX,
  marked,
  prepare,
  RESULT_MAX,
  RESULT_MAX_LINES,
  TEXT_MAX,
  THINKING_MAX,
  toolView,
  type TerminalParser,
} from '../terminal';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;
type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;
type ResultEntry = Extract<TerminalEntry, { kind: 'result' }>;

const SEEN_MAX = 20_000;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function cleanStr(v: unknown): string {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function cleanUserPrompt(raw: string): string {
  const m = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(raw);
  if (m) return m[1]!.trim();
  return raw
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, '')
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .trim();
}

function cleanToolOutput(raw: string): string {
  return raw.replace(/^(?:Created At:[^\n]*\n)?(?:Completed At:[^\n]*\n)?/, '').trim();
}

function formatAntigravityTool(name: string, rawArgs: Rec | undefined): { tool: string; title: string; input?: string; inputKind?: TerminalInputKind } {
  const args = rawArgs ?? {};
  switch (name) {
    case 'read_file': {
      const filePath = cleanStr(args.Path);
      return { tool: 'Read', ...toolView('Read', { file_path: filePath }) };
    }
    case 'write_file': {
      const filePath = cleanStr(args.Path);
      const content = cleanStr(args.Content);
      return { tool: 'Write', ...toolView('Write', { file_path: filePath, content }) };
    }
    case 'edit_file': {
      const filePath = cleanStr(args.Path);
      const oldStr = cleanStr(args.Target);
      const newStr = cleanStr(args.Replacement);
      return { tool: 'Edit', ...toolView('Edit', { file_path: filePath, old_string: oldStr, new_string: newStr }) };
    }
    case 'run_command': {
      const command = cleanStr(args.CommandLine);
      return { tool: 'Bash', ...toolView('Bash', { command }) };
    }
    case 'search_web': {
      const query = cleanStr(args.query);
      return { tool: 'WebSearch', ...toolView('WebSearch', { query }) };
    }
    case 'call_mcp_tool': {
      const server = cleanStr(args.ServerName) || 'mcp';
      const toolName = cleanStr(args.ToolName) || 'tool';
      const mcpTool = `mcp__${server}__${toolName}`;
      const innerArgs = rec(args.Arguments) ?? args;
      return { tool: mcpTool, ...toolView(mcpTool, innerArgs) };
    }
    case 'invoke_subagent': {
      const role = cleanStr(args.Role) || cleanStr(args.TypeName) || 'subagent';
      const prompt = cleanStr(args.Prompt);
      const input = prompt ? marked(prepare(prompt, INPUT_MAX)) : undefined;
      return {
        tool: 'Task',
        title: `Task(${role})`,
        ...(input ? { input, inputKind: 'text' as const } : {}),
      };
    }
    default:
      return { tool: name, ...toolView(name, args) };
  }
}

class AntigravityTerminalParser implements TerminalParser {
  private out: TerminalEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly pendingTools: string[] = [];
  private lastAt?: number;
  private seq = 0;

  push(line: string): TerminalEntry[] {
    this.out = [];
    try {
      this.parseLine(line);
    } catch {
      // Ignore malformed lines
    }
    return this.out;
  }

  private emit(e: TerminalEntry): void {
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value as string);
    this.out.push(e);
  }

  private parseLine(raw: string): void {
    if (!raw || raw.length < 2) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const step = rec(parsed);
    if (!step) return;

    const ts = typeof step.created_at === 'string' ? Date.parse(step.created_at) : NaN;
    if (!Number.isNaN(ts)) this.lastAt = ts;
    const at = (!Number.isNaN(ts) ? ts : this.lastAt) ?? Date.now();
    const key = typeof step.step_index === 'number' ? `s${step.step_index}` : `l${++this.seq}`;
    const type = typeof step.type === 'string' ? step.type : '';

    if (type === 'USER_INPUT') {
      const content = typeof step.content === 'string' ? cleanUserPrompt(step.content) : '';
      if (!content) return;
      const text = marked(prepare(content, TEXT_MAX));
      if (text) this.emit({ kind: 'user', id: `${key}:u`, at, text });
      return;
    }

    if (type === 'PLANNER_RESPONSE') {
      if (typeof step.thinking === 'string' && step.thinking.trim()) {
        const text = marked(prepare(step.thinking.trim(), THINKING_MAX));
        this.emit(text ? { kind: 'thinking', id: `${key}:th`, at, text } : { kind: 'thinking', id: `${key}:th`, at });
      }

      if (typeof step.content === 'string' && step.content.trim()) {
        const text = marked(prepare(step.content.trim(), TEXT_MAX));
        if (text) this.emit({ kind: 'assistant', id: `${key}:a`, at, text });
      }

      if (Array.isArray(step.tool_calls)) {
        step.tool_calls.forEach((rawCall, idx) => {
          const call = rec(rawCall);
          if (!call || typeof call.name !== 'string') return;
          const toolId = `${key}:t${idx}`;
          const formatted = formatAntigravityTool(call.name, rec(call.args));
          const entry: ToolEntry = {
            kind: 'tool',
            id: toolId,
            at,
            tool: formatted.tool,
            title: maskSecrets(formatted.title),
          };
          if (formatted.input) {
            entry.input = formatted.input;
            entry.inputKind = formatted.inputKind;
          }
          this.emit(entry);
          this.pendingTools.push(toolId);
          if (this.pendingTools.length > 64) this.pendingTools.shift();
        });
      }
      return;
    }

    if (type === 'GENERIC' || type === 'TOOL_RESPONSE') {
      const rawContent = typeof step.content === 'string' ? cleanToolOutput(step.content) : '';
      const toolId = this.pendingTools.shift() ?? `${key}:t0`;
      const p = prepare(rawContent, RESULT_MAX, RESULT_MAX_LINES);
      const entry: ResultEntry = {
        kind: 'result',
        id: `${key}:r`,
        at,
        toolUseId: toolId,
        text: p.text || tr('(no output)'),
      };
      if (step.status === 'ERROR') entry.error = true;
      if (p.truncated) entry.truncated = true;
      this.emit(entry);
    }
  }
}

export function createAntigravityTerminalParser(): TerminalParser {
  return new AntigravityTerminalParser();
}

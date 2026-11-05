import { basename } from 'node:path';
import type { Activity, ActivityKind, AgentStatus } from '../../../shared/types';

export interface AntigravitySessionState {
  conversationId: string;
  stepCount: number;
  status: AgentStatus;
  waitingFor?: string;
  inputTokens: number;
  outputTokens: number;
  latestActivity?: Activity;
  lastStepIndex: number;
}

export function createAntigravitySessionState(conversationId: string): AntigravitySessionState {
  return {
    conversationId,
    stepCount: 0,
    status: 'idle',
    inputTokens: 0,
    outputTokens: 0,
    lastStepIndex: -1,
  };
}

export interface ToolCallItem {
  name: string;
  args?: Record<string, unknown>;
}

export function describeToolCall(call: ToolCallItem): string {
  const name = call.name;
  const args = call.args ?? {};

  const cleanPath = (p: unknown): string => {
    if (typeof p !== 'string') return '';
    return basename(p.replace(/^[\\"']+|[\\"']+$/g, ''));
  };

  switch (name) {
    case 'read_file': {
      const f = cleanPath(args.Path);
      return f ? `Lendo ${f}` : 'Lendo arquivo';
    }
    case 'write_file': {
      const f = cleanPath(args.Path);
      return f ? `Criando ${f}` : 'Criando arquivo';
    }
    case 'edit_file': {
      const f = cleanPath(args.Path);
      return f ? `Editando ${f}` : 'Editando arquivo';
    }
    case 'run_command': {
      const cmd = typeof args.CommandLine === 'string' ? args.CommandLine.trim() : '';
      return cmd ? `Executando: ${cmd.slice(0, 32)}` : 'Executando comando';
    }
    case 'search_web': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      return q ? `Pesquisando na web: ${q.slice(0, 24)}` : 'Pesquisando na web';
    }
    case 'ask_question': {
      return 'Aguardando resposta';
    }
    case 'invoke_subagent': {
      const role = typeof args.Role === 'string' ? args.Role.trim() : '';
      return role ? `Iniciando subagente (${role})` : 'Iniciando subagente';
    }
    case 'call_mcp_tool': {
      const t = typeof args.ToolName === 'string' ? args.ToolName.trim() : 'mcp';
      return `Chamando MCP (${t})`;
    }
    default:
      return `Usando ${name}`;
  }
}

export function toolCallToActivity(call: ToolCallItem, seq: number, at: number): Activity {
  const name = call.name;
  const text = describeToolCall(call);

  let kind: ActivityKind = 'other';
  let icon = '⚡';

  switch (name) {
    case 'read_file':
      kind = 'read';
      icon = '📖';
      break;
    case 'write_file':
      kind = 'write';
      icon = '📝';
      break;
    case 'edit_file':
      kind = 'edit';
      icon = '✏️';
      break;
    case 'run_command':
      kind = 'run';
      icon = '💻';
      break;
    case 'search_web':
      kind = 'web';
      icon = '🌐';
      break;
    case 'ask_question':
      kind = 'ask';
      icon = '❓';
      break;
    case 'invoke_subagent':
      kind = 'delegate';
      icon = '🤝';
      break;
    case 'call_mcp_tool':
      kind = 'mcp';
      icon = '🔌';
      break;
  }

  return {
    id: `tool-${seq}`,
    kind,
    icon,
    text,
    tool: name,
    at,
  };
}

interface RawStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  input_tokens?: number;
  output_tokens?: number;
  tool_calls?: ToolCallItem[];
}

export function parseTranscriptLine(line: string, state: AntigravitySessionState): Activity | undefined {
  if (!line || !line.trim()) return undefined;
  let step: RawStep;
  try {
    step = JSON.parse(line) as RawStep;
  } catch {
    return undefined;
  }

  state.stepCount++;
  if (typeof step.step_index === 'number') {
    state.lastStepIndex = step.step_index;
  }

  const at = step.created_at ? new Date(step.created_at).getTime() || Date.now() : Date.now();

  if (typeof step.input_tokens === 'number') {
    state.inputTokens += step.input_tokens;
  }
  if (typeof step.output_tokens === 'number') {
    state.outputTokens += step.output_tokens;
  }

  if (step.type === 'USER_INPUT') {
    state.status = 'working';
    state.waitingFor = undefined;
    const act: Activity = {
      id: `prompt-${state.stepCount}`,
      kind: 'prompt',
      icon: '💬',
      text: 'Recebeu instrução do usuário',
      at,
    };
    state.latestActivity = act;
    return act;
  }

  if (step.type === 'PLANNER_RESPONSE') {
    const tools = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (tools.length > 0) {
      const first = tools[0]!;
      if (first.name === 'ask_question') {
        state.status = 'waiting';
        state.waitingFor = 'Pergunta';
      } else {
        state.status = 'working';
        state.waitingFor = undefined;
      }
      const act = toolCallToActivity(first, state.stepCount, at);
      state.latestActivity = act;
      return act;
    }

    if (step.thinking && step.thinking.trim()) {
      state.status = 'working';
      state.waitingFor = undefined;
      const act: Activity = {
        id: `think-${state.stepCount}`,
        kind: 'think',
        icon: '🧠',
        text: 'Pensando e planejando',
        at,
      };
      state.latestActivity = act;
      return act;
    }

    // Finished response step without pending tool
    state.status = 'idle';
    state.waitingFor = undefined;
    const act: Activity = {
      id: `respond-${state.stepCount}`,
      kind: 'done',
      icon: '✓',
      text: 'Concluiu a resposta',
      at,
    };
    state.latestActivity = act;
    return act;
  }

  return undefined;
}

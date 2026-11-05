import { describe, expect, it } from 'vitest';
import { handleMcpRequest, MCP_TOOLS } from './mcp';

describe('habblaud-mcp JSON-RPC handler', () => {
  it('responds to initialize with protocolVersion and serverInfo', async () => {
    const res = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'habblaud-mcp',
          version: '1.0.3',
        },
        capabilities: {
          tools: { listChanged: false },
        },
        instructions: expect.stringContaining('127.0.0.1:4747'),
      },
    });
  });

  it('lists all Habblaud MCP tools on tools/list', async () => {
    const res = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: MCP_TOOLS,
      },
    });
  });

  it('returns null for notifications without id', async () => {
    const res = await handleMcpRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(res).toBeNull();
  });
});

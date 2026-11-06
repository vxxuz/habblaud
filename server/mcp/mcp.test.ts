import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { McpControlService } from './service';

describe('McpControlService', () => {
  it('reads mcp_config.json and schema directories and parses codebase-memory projects output', async () => {
    const tmp = tempDir();
    try {
      const cfgDir = join(tmp.dir, '.gemini', 'config');
      const schemaDir = join(tmp.dir, '.gemini', 'antigravity-cli', 'mcp', 'codebase-memory-mcp');
      mkdirSync(cfgDir, { recursive: true });
      mkdirSync(schemaDir, { recursive: true });

      writeFileSync(
        join(cfgDir, 'mcp_config.json'),
        JSON.stringify({
          mcpServers: {
            'codebase-memory-mcp': { command: 'codebase-memory-mcp', args: [] },
            'habblaud-mcp': { command: 'habblaud-mcp', args: [] },
          },
        }),
      );
      writeFileSync(
        join(schemaDir, 'search_graph.json'),
        JSON.stringify({
          name: 'search_graph',
          description: 'Find functions and classes in the graph.',
        }),
      );

      const office = new Office({
        names: new NameStore(null),
        version: '1.0.3',
        startedAt: Date.now(),
        accounts: () => [],
        sources: () => [],
        accountName: () => undefined,
      });

      const svc = new McpControlService({ office, home: tmp.dir });
      const servers = svc.readServers();
      expect(servers.map((s) => s.name)).toEqual(['codebase-memory-mcp', 'habblaud-mcp']);
      expect(servers[0]?.tools).toEqual([{ name: 'search_graph', description: 'Find functions and classes in the graph.' }]);

      const projects = svc.parseProjectsOutput(
        [
          'projects: 2  (cols: name root_path branch)',
          '  home-inok-habblaud /home/inok/habblaud main',
          '  home-inok-my-app "/home/inok/My App" -',
          'total: 2',
        ].join('\n'),
      );
      expect(projects).toEqual([
        { name: 'home-inok-habblaud', rootPath: '/home/inok/habblaud', branch: 'main' },
        { name: 'home-inok-my-app', rootPath: '/home/inok/My App', branch: '-' },
      ]);
    } finally {
      tmp.cleanup();
    }
  });
});

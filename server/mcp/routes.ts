import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import type { McpControlService } from './service';

export function createMcpRoutes(service: McpControlService): (req: IncomingMessage, res: ServerResponse, url: URL) => void {
  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: 'Internal server error' });
  };

  return (req, res, url) => {
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/api/mcp' || path === '/api/mcp/status') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const refresh = url.searchParams.get('refresh') === '1';
      service
        .getStatus(refresh)
        .then((status) => sendJson(res, 200, status))
        .catch((err) => fail(res, err));
      return;
    }

    if (path === '/api/mcp/codebase-memory/index') {
      if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      readJson(req)
        .then(async (body) => {
          const b = body as { repoPath?: unknown };
          const repoPath = typeof b?.repoPath === 'string' ? b.repoPath.trim() : '';
          if (!repoPath) throw new HttpError(400, 'Expected {repoPath: string}');
          const result = await service.indexRepository(repoPath);
          sendJson(res, 200, result);
        })
        .catch((err) => fail(res, err));
      return;
    }

    if (path === '/api/mcp/codebase-memory/search') {
      if (method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      readJson(req)
        .then(async (body) => {
          const b = body as { project?: unknown; query?: unknown };
          const project = typeof b?.project === 'string' ? b.project.trim() : '';
          const query = typeof b?.query === 'string' ? b.query.trim() : '';
          if (!query) throw new HttpError(400, 'Expected {query: string}');
          const result = await service.searchGraph(project, query);
          sendJson(res, 200, result);
        })
        .catch((err) => fail(res, err));
      return;
    }

    sendJson(res, 404, { error: 'Unknown route' });
  };
}

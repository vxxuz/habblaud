import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { Office } from '../model/office';
import type { ArtifactScanner } from '../sources/antigravity/artifacts';
import type { MessageRegistry } from '../messages/registry';

export interface CeoRoutesDeps {
  scanner: ArtifactScanner;
  office: Office;
  messages?: MessageRegistry;
}

export function createCeoRoutes(deps: CeoRoutesDeps) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (path !== '/api/ceo/decision') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    let body: any;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }

    const { agentId, artifactId, decision, feedback } = body ?? {};
    if (!agentId || !artifactId || (decision !== 'approve' && decision !== 'reject')) {
      sendJson(res, 400, { error: 'expected { agentId, artifactId, decision: "approve" | "reject", feedback? }' });
      return;
    }

    const sessionId = agentId.replace(/^antigravity:/, '');

    if (decision === 'approve') {
      deps.scanner.approve(sessionId, artifactId);
      deps.office.setPendingArtifact(agentId, undefined);

      if (deps.messages) {
        deps.messages.send({
          agentId,
          text: `[Approved] ${artifactId}`,
        });
      }

      sendJson(res, 200, { ok: true, status: 'approved' });
      return;
    }

    if (decision === 'reject') {
      deps.office.setPendingArtifact(agentId, undefined);

      if (deps.messages) {
        const text = feedback?.trim() ? `[Rejected] ${feedback.trim()}` : `[Rejected] ${artifactId}`;
        deps.messages.send({
          agentId,
          text,
        });
      }

      sendJson(res, 200, { ok: true, status: 'rejected' });
      return;
    }
  };
}

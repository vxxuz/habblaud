import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { readJson, sendJson } from '../http/app';
import type { Office } from '../model/office';
import type { ArtifactScanner } from '../sources/antigravity/artifacts';
import type { MessageRegistry } from '../messages/registry';

export interface CeoRoutesDeps {
  scanner: ArtifactScanner;
  office: Office;
  messages?: MessageRegistry;
  antigravityDir?: string;
}

function deliverAntigravityMessage(antigravityDir: string | undefined, sessionId: string, text: string): void {
  if (!antigravityDir) return;
  const msgDir = join(antigravityDir, 'brain', sessionId, '.system_generated', 'messages');
  if (!existsSync(msgDir)) return;
  const msgId = randomUUID();
  const file = join(msgDir, `${msgId}.json`);
  const payload = {
    id: msgId,
    recipient: sessionId,
    sender: 'user',
    priority: 'MESSAGE_PRIORITY_HIGH',
    timestamp: new Date().toISOString(),
    content: text,
  };
  try {
    writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    // ignore
  }
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

      const approvalText = `[Approved] ${artifactId}`;
      deliverAntigravityMessage(deps.antigravityDir, sessionId, approvalText);

      if (deps.messages) {
        deps.messages.send({
          agentId,
          text: approvalText,
        });
      }

      sendJson(res, 200, { ok: true, status: 'approved' });
      return;
    }

    if (decision === 'reject') {
      deps.scanner.reject(sessionId, artifactId);
      deps.office.setPendingArtifact(agentId, undefined);

      const text = feedback?.trim() ? `[Rejected] ${feedback.trim()}` : `[Rejected] ${artifactId}`;
      deliverAntigravityMessage(deps.antigravityDir, sessionId, text);

      if (deps.messages) {
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

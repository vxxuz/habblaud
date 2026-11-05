import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { createCeoRoutes } from './routes';
import { ArtifactScanner } from '../sources/antigravity/artifacts';

function mockReq(body: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function mockRes(): { res: ServerResponse; getStatus: () => number; getBody: () => any } {
  let status = 200;
  let body = '';
  const res = {
    statusCode: 200,
    setHeader: () => {},
    writeHead: (s: number) => {
      status = s;
      return res;
    },
    end: (chunk?: string | Buffer) => {
      if (chunk) body += chunk.toString();
    },
  } as unknown as ServerResponse;
  return {
    res,
    getStatus: () => res.statusCode || status,
    getBody: () => (body ? JSON.parse(body) : undefined),
  };
}

describe('CEO decision routes', () => {
  it('approves artifact, updates scanner and delivers approval message', async () => {
    const scanner = new ArtifactScanner();
    let cleared = false;
    let deliveredText = '';

    const office = {
      setPendingArtifact: (id: string, art?: any) => {
        if (!art) cleared = true;
      },
    };

    const messages = {
      send: (msg: { agentId: string; text: string }) => {
        deliveredText = msg.text;
        return { message: { id: 'm1', status: 'queued' } };
      },
    };

    const handler = createCeoRoutes({
      scanner,
      office: office as any,
      messages: messages as any,
    });

    const { res, getStatus, getBody } = mockRes();
    const req = mockReq({
      agentId: 'antigravity:s1',
      artifactId: 'plan.md',
      decision: 'approve',
    });

    await handler(req, res, '/api/ceo/decision');

    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ ok: true, status: 'approved' });
    expect(scanner.isApproved('s1', 'plan.md')).toBe(true);
    expect(cleared).toBe(true);
    expect(deliveredText).toContain('[Approved] plan.md');
  });
});

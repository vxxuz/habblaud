import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PendingArtifact } from '../../../shared/types';

export interface ArtifactMetadata {
  summary?: string;
  updatedAt?: string;
  requestFeedback?: boolean;
  userFacing?: boolean;
}

export interface ArtifactScannerOptions {
  approvalsPath?: string;
}

export class ArtifactScanner {
  private approved = new Set<string>();
  private readonly approvalsPath?: string;

  constructor(opts: ArtifactScannerOptions = {}) {
    this.approvalsPath = opts.approvalsPath;
    this.loadApprovals();
  }

  loadApprovals(): void {
    if (!this.approvalsPath || !existsSync(this.approvalsPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.approvalsPath, 'utf8'));
      if (Array.isArray(data)) {
        this.approved = new Set(data);
      }
    } catch {
      // ignore invalid json
    }
  }

  saveApprovals(): void {
    if (!this.approvalsPath) return;
    try {
      writeFileSync(this.approvalsPath, JSON.stringify([...this.approved], null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  approve(sessionId: string, artifactName: string): void {
    this.approved.add(`${sessionId}:${artifactName}`);
    this.approved.add(artifactName);
    this.saveApprovals();
  }

  isApproved(sessionId: string, artifactName: string): boolean {
    return this.approved.has(`${sessionId}:${artifactName}`) || this.approved.has(artifactName);
  }

  scanSession(sessionId: string, sessionBrainDir: string): PendingArtifact | undefined {
    if (!existsSync(sessionBrainDir)) return undefined;
    try {
      const entries = readdirSync(sessionBrainDir);
      const candidates: PendingArtifact[] = [];

      for (const file of entries) {
        if (!file.endsWith('.metadata.json')) continue;
        const artifactName = file.slice(0, -'.metadata.json'.length);
        if (this.isApproved(sessionId, artifactName)) continue;

        const metaPath = join(sessionBrainDir, file);
        try {
          const raw = readFileSync(metaPath, 'utf8');
          const meta: ArtifactMetadata = JSON.parse(raw);
          // Only artifacts with requestFeedback: true require CEO approval!
          if (!meta.requestFeedback) continue;

          const artifactPath = join(sessionBrainDir, artifactName);
          const updatedAt = meta.updatedAt ? Date.parse(meta.updatedAt) : Date.now();
          candidates.push({
            id: artifactName,
            name: artifactName,
            summary: meta.summary,
            updatedAt,
            path: artifactPath,
          });
        } catch {
          // ignore malformed metadata
        }
      }

      if (candidates.length === 0) return undefined;
      candidates.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      return candidates[0];
    } catch {
      return undefined;
    }
  }
}

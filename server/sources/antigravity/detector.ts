import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

export function getAntigravityHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.ANTIGRAVITY_HOME && env.ANTIGRAVITY_HOME.trim()) return env.ANTIGRAVITY_HOME.trim();
  if (env.GEMINI_CLI_HOME && env.GEMINI_CLI_HOME.trim()) return env.GEMINI_CLI_HOME.trim();
  return join(home, '.gemini', 'antigravity-cli');
}

/**
 * Parses Linux /proc/locks into a map of file inode -> PID holding advisory lock.
 * Format sample:
 * "3: FLOCK  ADVISORY  WRITE 10621 103:02:740077551 0 EOF"
 */
export function parseProcLocks(content: string): Map<number, number> {
  const map = new Map<number, number>();
  const lines = content.split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 6) {
      const pid = Number.parseInt(parts[4] ?? '', 10);
      const fileDeviceAndInode = parts[5] ?? '';
      const inodeStr = fileDeviceAndInode.split(':').pop();
      const inode = Number.parseInt(inodeStr ?? '', 10);
      if (Number.isFinite(pid) && Number.isFinite(inode)) {
        map.set(inode, pid);
      }
    }
  }
  return map;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface DetectOptions {
  procLocksContent?: string | null;
  procLocksPath?: string;
  isPidAlive?: (pid: number) => boolean;
  maxAgeMs?: number;
}

export function detectActiveLocks(presenceDir: string, options: DetectOptions = {}): string[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(presenceDir).filter((f) => f.endsWith('.lock'));
  } catch {
    return [];
  }

  let procLocksContent: string | null | undefined = options.procLocksContent;
  if (procLocksContent === undefined) {
    try {
      procLocksContent = readFileSync(options.procLocksPath ?? '/proc/locks', 'utf8');
    } catch {
      procLocksContent = null;
    }
  }

  const pidAlive = options.isPidAlive ?? isProcessAlive;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = Date.now();

  const active: string[] = [];

  if (procLocksContent !== null) {
    const inodePidMap = parseProcLocks(procLocksContent);
    for (const fileName of fileNames) {
      const filePath = join(presenceDir, fileName);
      try {
        const st = statSync(filePath);
        const pid = inodePidMap.get(st.ino);
        if (pid !== undefined && pidAlive(pid)) {
          active.push(fileName.slice(0, -5));
        }
      } catch {
        // file unreadable or deleted
      }
    }
  } else {
    // Fallback: check file modification time
    for (const fileName of fileNames) {
      const filePath = join(presenceDir, fileName);
      try {
        const st = statSync(filePath);
        if (now - st.mtimeMs <= maxAgeMs) {
          active.push(fileName.slice(0, -5));
        }
      } catch {
        // file unreadable or deleted
      }
    }
  }

  return active;
}

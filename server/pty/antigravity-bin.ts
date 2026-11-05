import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findExecutable, isExecutableFile } from '../claude-bin';

export function findAgyBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const set = env.HABBLAUD_ANTIGRAVITY_BIN?.trim() || env.HABBLAUD_AGY_BIN?.trim();
  if (set) {
    return /[\\/]/.test(set) ? resolve(set) : findExecutable(set, env, platform);
  }

  // 1. Check in PATH
  const fromPath = findExecutable('agy', env, platform);
  if (fromPath) return fromPath;

  // 2. Fallback check in ~/.local/bin/agy
  const home = env.HOME || homedir();
  const localBin = join(home, '.local', 'bin', platform === 'win32' ? 'agy.exe' : 'agy');
  if (isExecutableFile(localBin, platform)) {
    return localBin;
  }

  return undefined;
}

export function runnableAgyBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const bin = findAgyBin(env, platform);
  return bin && isExecutableFile(bin, platform) ? bin : undefined;
}

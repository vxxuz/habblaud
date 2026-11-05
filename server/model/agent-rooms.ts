import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '../log';

export class AgentRooms {
  private rooms = new Map<string, string>();

  constructor(private readonly file: string | null) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { rooms?: Record<string, unknown> };
      for (const [k, v] of Object.entries(j.rooms ?? {})) {
        if (typeof v === 'string' && v.trim()) this.rooms.set(k.trim(), v.trim());
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`agent-rooms.json unreadable (${errMsg(err)}); starting with empty room assignments.`);
      }
    }
  }

  get(key: string): string | undefined {
    return this.rooms.get(key.trim());
  }

  set(key: string, roomId: string): void {
    const k = key.trim();
    const r = roomId.trim();
    if (!k || !r) return;
    if (this.rooms.get(k) === r) return;
    this.rooms.set(k, r);
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, rooms: Object.fromEntries(this.rooms) }, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warn(`Could not save ${this.file}: ${errMsg(err)}`);
    }
  }
}

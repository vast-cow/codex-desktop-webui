import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
interface Entry { files?: Record<string, Entry>; offset?: string; size?: number; unpacked?: boolean; link?: string }
export class Archive {
  private constructor(readonly path: string, private tree: Entry, private base: number) {}
  static async open(path: string) {
    const file = await open(path, 'r');
    try {
      const prefix = Buffer.alloc(16);
      await file.read(prefix, 0, 16, 0);
      const size = prefix.readUInt32LE(12);
      if (size > 64 * 1024 * 1024 || prefix.readUInt32LE(0) !== 4) throw Error('Invalid ASAR header');
      const header = Buffer.alloc(size);
      const result = await file.read(header, 0, size, 16);
      if (result.bytesRead !== size) throw Error('Truncated ASAR header');
      return new Archive(path, JSON.parse(header.toString()), 8 + prefix.readUInt32LE(4));
    } finally { await file.close(); }
  }
  entries(): string[] {
    const result: string[] = [];
    function visit(node: Entry, prefix: string) {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        if (name === '.' || name === '..' || /[/\\\0]/.test(name)) throw Error('Unsafe ASAR path');
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.files) visit(entry, path); else result.push(path);
      }
    }
    visit(this.tree, '');
    return result.sort();
  }
  async read(path: string): Promise<Buffer> {
    let entry = this.tree;
    for (const name of path.split('/')) {
      if (!name || name === '..' || name === '.') throw Error('Unsafe ASAR path');
      entry = entry.files?.[name]!;
      if (!entry) throw Error(`Missing ASAR entry: ${path}`);
    }
    if (entry.link || entry.files) throw Error(`Unsupported ASAR entry: ${path}`);
    if (entry.unpacked) return readFile(`${this.path}.unpacked/${path}`);
    const offset = Number(entry.offset), size = entry.size!;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0) throw Error('Invalid ASAR extent');
    const file = await open(this.path, 'r');
    try {
      const data = Buffer.alloc(size);
      const result = await file.read(data, 0, size, this.base + offset);
      if (result.bytesRead !== size) throw Error(`Truncated ASAR entry: ${path}`);
      return data;
    } finally { await file.close(); }
  }
}

import { GUTENBERG_TAR_MEMBER_MAX_BYTES } from './constants';
import { GutenbergSnapshotError } from './errors';

const TAR_BLOCK_SIZE = 512;
const TAR_BASE_256_FLAG = 0x80;
const TAR_OCTAL_BASE = 8;

export type TarMember = {
  /** Effective member path after GNU long-name or PAX path resolution. */
  name: string;
  /** Member payload. Only one member is retained at a time by the consumer. */
  content: Buffer;
};

/**
 * Reads a tar archive incrementally from an already decompressed byte stream.
 * Exactly one member payload is buffered at a time and released after yield,
 * so the full archive is never held in memory.
 */
export async function* iterateTarMembers(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarMember> {
  const reader = new ByteReader(source);
  let gnuLongName: string | null = null;
  let paxPath: string | null = null;

  for (;;) {
    const header = await reader.readExactly(TAR_BLOCK_SIZE);
    if (header === null) {
      return;
    }
    if (isZeroBlock(header)) {
      // The archive terminator is the first all-zero block.
      return;
    }

    const { name, prefix, size, typeFlag } = parseTarHeader(header);
    const declaredName = prefix.length > 0 ? `${prefix}/${name}` : name;
    // A pending long name / PAX path applies only to the immediately following entry.
    const pendingLongName = gnuLongName;
    const pendingPaxPath = paxPath;
    gnuLongName = null;
    paxPath = null;

    if (size > GUTENBERG_TAR_MEMBER_MAX_BYTES) {
      throw new GutenbergSnapshotError('a tar member exceeded the bounded decompression limit');
    }

    const content = size > 0 ? await reader.readExactly(size) : Buffer.alloc(0);
    if (content === null) {
      throw new GutenbergSnapshotError('the tar stream ended before a member payload was complete');
    }
    await reader.skip(paddingFor(size));

    if (typeFlag === 'L') {
      gnuLongName = trimNullTerminated(content.toString('utf8'));
      continue;
    }
    if (typeFlag === 'x') {
      const parsedPath = parsePaxPath(content.toString('utf8'));
      if (parsedPath) {
        paxPath = parsedPath;
      }
      continue;
    }
    if (typeFlag === 'g' || typeFlag === '5') {
      continue;
    }
    if (typeFlag !== '0' && typeFlag !== '\0') {
      // Unsupported entry type (link, character device, ...): skip without yielding.
      continue;
    }

    const effectiveName = pendingPaxPath ?? pendingLongName ?? declaredName;

    if (effectiveName.length > 0) {
      yield { name: effectiveName, content };
    }
  }
}

function parseTarHeader(header: Buffer): { name: string; prefix: string; size: number; typeFlag: string } {
  return {
    name: readCString(header, 0, 100),
    prefix: readCString(header, 345, 155),
    size: parseTarNumber(header.subarray(124, 136)),
    typeFlag: String.fromCharCode(header[156] ?? 0),
  };
}

function readCString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const terminator = slice.indexOf(0);
  const value = terminator === -1 ? slice : slice.subarray(0, terminator);
  return value.toString('utf8').trim();
}

function parseTarNumber(field: Buffer): number {
  const first = field[0] ?? 0;
  if ((first & TAR_BASE_256_FLAG) !== 0) {
    let value = first & 0x7f;
    for (let index = 1; index < field.length; index += 1) {
      value = value * 256 + (field[index] ?? 0);
    }
    return value;
  }

  const text = readCString(field, 0, field.length);
  if (text.length === 0) {
    return 0;
  }
  const parsed = Number.parseInt(text, TAR_OCTAL_BASE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isZeroBlock(header: Buffer): boolean {
  for (const byte of header) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function paddingFor(size: number): number {
  return (TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
}

function trimNullTerminated(value: string): string {
  const terminator = value.indexOf('\0');
  return (terminator === -1 ? value : value.slice(0, terminator)).trim();
}

function parsePaxPath(content: string): string | null {
  for (const line of content.split('\n')) {
    const space = line.indexOf(' ');
    if (space === -1) {
      continue;
    }
    const entry = line.slice(space + 1);
    const equals = entry.indexOf('=');
    if (equals === -1) {
      continue;
    }
    if (entry.slice(0, equals) === 'path') {
      return entry.slice(equals + 1);
    }
  }
  return null;
}

/** Pull-based buffered reader over an async byte source. */
class ByteReader {
  private readonly chunks: Buffer[] = [];
  private buffered = 0;
  private ended = false;
  private readonly iterator: AsyncIterator<Uint8Array>;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  async readExactly(count: number): Promise<Buffer | null> {
    if (count === 0) {
      return Buffer.alloc(0);
    }
    while (this.buffered < count) {
      if (!(await this.pull())) {
        if (this.buffered === 0) {
          return null;
        }
        throw new GutenbergSnapshotError('the tar stream ended unexpectedly');
      }
    }
    return this.take(count);
  }

  async skip(count: number): Promise<void> {
    let remaining = count;
    while (remaining > 0) {
      if (this.buffered === 0 && !(await this.pull())) {
        throw new GutenbergSnapshotError('the tar stream ended unexpectedly');
      }
      const consume = Math.min(remaining, this.buffered);
      this.take(consume);
      remaining -= consume;
    }
  }

  private async pull(): Promise<boolean> {
    if (this.ended) {
      return false;
    }
    const { value, done } = await this.iterator.next();
    if (done) {
      this.ended = true;
      return false;
    }
    if (value && value.length > 0) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    return true;
  }

  private take(count: number): Buffer {
    const output = Buffer.allocUnsafe(count);
    let offset = 0;
    while (offset < count) {
      const head = this.chunks[0]!;
      const remaining = count - offset;
      if (head.length <= remaining) {
        head.copy(output, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        head.copy(output, offset, 0, remaining);
        this.chunks[0] = head.subarray(remaining);
        offset += remaining;
      }
    }
    this.buffered -= count;
    return output;
  }
}

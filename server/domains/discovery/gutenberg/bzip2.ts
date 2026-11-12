import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { GUTENBERG_BZIP2_STDERR_MAX_BYTES } from './constants';

export type Bzip2Completion = {
  ok: boolean;
  /** Sanitized, bounded reason when `ok` is false. */
  reason?: string;
};

export type Bzip2DecompressStream = {
  output: Readable;
  completion: Promise<Bzip2Completion>;
  /** Idempotent teardown: destroys the input, kills bzip2, and releases pipes. */
  close: () => void;
};

/**
 * Streams `input` through the system `bzip2 -dc` process using `shell: false`
 * and a fixed argument array. No URL, path, or metadata is ever interpolated
 * into a shell command. stderr is drained but retained only up to a bounded cap.
 */
export function createBzip2DecompressStream(input: Readable, signal?: AbortSignal): Bzip2DecompressStream {
  const child = spawn('bzip2', ['-dc'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });

  let stderrTail = '';
  let stderrBytes = 0;
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderrBytes >= GUTENBERG_BZIP2_STDERR_MAX_BYTES) {
      return;
    }
    const remaining = GUTENBERG_BZIP2_STDERR_MAX_BYTES - stderrBytes;
    const slice = chunk.subarray(0, remaining);
    stderrTail += slice.toString('utf8');
    stderrBytes += slice.length;
  });

  let settled = false;
  let resolveCompletion: (value: Bzip2Completion) => void = () => undefined;
  const completion = new Promise<Bzip2Completion>((resolve) => {
    resolveCompletion = resolve;
  });

  const finish = (value: Bzip2Completion): void => {
    if (settled) {
      return;
    }
    settled = true;
    resolveCompletion(value);
  };

  const close = (): void => {
    input.destroy();
    child.stdin.destroy();
    child.stdout.destroy();
    child.kill('SIGKILL');
  };

  child.on('error', (error: NodeJS.ErrnoException) => {
    finish({
      ok: false,
      reason:
        error.code === 'ENOENT'
          ? 'bzip2 is not available in the backend runtime'
          : 'the bzip2 decompression process could not be started',
    });
    close();
  });

  child.on('close', (code, terminationSignal) => {
    if (code === 0) {
      finish({ ok: true });
      return;
    }
    finish({ ok: false, reason: buildBzip2FailureReason(code, terminationSignal, stderrTail) });
  });

  input.on('error', () => {
    finish({ ok: false, reason: 'the Project Gutenberg snapshot download stream failed' });
    close();
  });

  child.stdin.on('error', () => {
    // Expected when bzip2 exits before consuming all input (e.g. a corrupt stream).
  });

  const abort = (): void => {
    finish({ ok: false, reason: 'the Project Gutenberg snapshot sync was aborted' });
    close();
  };
  if (signal) {
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  }

  input.pipe(child.stdin);

  return { output: child.stdout, completion, close };
}

function buildBzip2FailureReason(
  code: number | null,
  terminationSignal: NodeJS.Signals | null,
  stderrTail: string,
): string {
  const headline =
    code === null
      ? `bzip2 terminated by signal ${terminationSignal ?? 'unknown'}`
      : `bzip2 decompression failed with exit code ${code}`;
  const detail = stderrTail.replace(/\s+/g, ' ').trim().slice(0, 200);
  return detail.length > 0 ? `${headline}: ${detail}` : headline;
}

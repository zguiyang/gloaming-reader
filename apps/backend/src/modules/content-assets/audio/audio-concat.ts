import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/** Concat same-codec MP3 buffers via ffmpeg demuxer (`-c copy`). */
export async function concatMp3Buffers(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 0) {
    throw new Error('No audio parts to concatenate');
  }

  const dir = await mkdtemp(join(tmpdir(), 'gloaming-mp3-'));
  try {
    const listLines: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const path = join(dir, `seg-${String(i).padStart(4, '0')}.mp3`);
      await writeFile(path, parts[i]!);
      listLines.push(`file '${path.replace(/'/g, "'\\''")}'`);
    }
    const listPath = join(dir, 'concat.txt');
    const outPath = join(dir, 'chapter.mp3');
    await writeFile(listPath, `${listLines.join('\n')}\n`);
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/*  Uncompressed WAV copies for archive deposits, via ffmpeg.
 *  makeWavConverter() → async (bytes, ext) => Buffer, or null when ffmpeg isn't
 *  installed. Each take is decoded to 16-bit PCM at the rate it decodes to
 *  (48 kHz for Opus). Temporary files live in one folder, removed on exit.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeWavConverter(ffmpeg = "ffmpeg"){
  if(spawnSync(ffmpeg, ["-version"]).status !== 0) return null;
  const tmp = mkdtempSync(join(tmpdir(), "afd-wav-"));
  process.on("exit", () => { try{ rmSync(tmp, { recursive: true, force: true }); }catch(_){ } });
  let n = 0;
  return async (bytes, ext) => {
    const src = join(tmp, `in${++n}.${ext}`), out = join(tmp, `out${n}.wav`);
    writeFileSync(src, bytes);
    const r = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c:a", "pcm_s16le", out]);
    if(r.status !== 0){ try{ rmSync(src); }catch(_){ } throw new Error(String(r.stderr || "ffmpeg failed").trim().split("\n").pop()); }
    const wav = readFileSync(out); rmSync(src); rmSync(out);
    return wav;
  };
}

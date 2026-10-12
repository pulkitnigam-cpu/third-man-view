// Keep the first `fraction` of a CBR/VBR MPEG-1 Layer III file by cutting on frame boundaries (no re-encode).
// Usage: node scripts/trim-mp3.mjs <in.mp3> <out.mp3> [fraction=0.5]
import fs from "node:fs";

const [, , src, dst, frac = "0.5"] = process.argv;
let buf = fs.readFileSync(src);
let off = 0;
if (buf.toString("latin1", 0, 3) === "ID3") off = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);

const BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATE = [44100, 48000, 32000];
const frames = [];
for (let p = off; p + 4 <= buf.length; ) {
  if (buf[p] !== 0xff || (buf[p + 1] & 0xfe) !== 0xfa) break; // MPEG-1 Layer III sync
  const br = BITRATE[buf[p + 2] >> 4], sr = RATE[(buf[p + 2] >> 2) & 3], pad = (buf[p + 2] >> 1) & 1;
  if (!br || !sr) break;
  const len = Math.floor((144000 * br) / sr) + pad;
  frames.push([p, len]);
  p += len;
}
const isInfo = (f) => /Info|Xing/.test(buf.toString("latin1", f[0] + 36, f[0] + 40));
const audio = isInfo(frames[0]) ? frames.slice(1) : frames;
const keep = audio.slice(0, Math.round(audio.length * Number(frac)));
const end = keep.at(-1)[0] + keep.at(-1)[1];
// Drop the Xing/Info header (its frame count would be stale) and any ID3 tag.
const out = buf.subarray(keep[0][0], end);
fs.writeFileSync(dst, out);
const sec = (keep.length * 1152) / RATE[(buf[keep[0][0] + 2] >> 2) & 3];
console.log(`${audio.length} frames -> ${keep.length} frames (${sec.toFixed(2)} s), ${out.length} bytes`);

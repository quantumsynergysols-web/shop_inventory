// Writes the background music for the how-to video: docs/demo/music/howto-bed.mp3
//
//   node scripts/make-music.mjs [seconds]      (default 400 s)
//
// An original, calm track synthesised here from sine waves (no samples, no downloads, no existing
// melody): 78 BPM in D major, chords Dmaj9 - Bm9 - Gmaj7 - Asus4/A (two bars each), a soft pad,
// electric-piano-like chords on beats 1 and 3, a quiet bass, and a light arpeggio from the second
// round on; a stereo echo gives some room. Fades in and out. The installed ffmpeg encodes the MP3.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/demo/music/howto-bed.mp3');
const SR = 44100;
const SECONDS = Number(process.argv[2] ?? 400);
const N = Math.round(SECONDS * SR);
const BPM = 78;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const L = new Float32Array(N);
const R = new Float32Array(N);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// chord tones (MIDI) for pad / electric piano, bass root, arpeggio notes
const CHORDS = [
  { pad: [57, 62, 64, 66, 69], bass: 38, arp: [74, 76, 78, 81, 78, 76, 73, 76] }, // Dmaj9
  { pad: [57, 59, 61, 62, 66], bass: 35, arp: [71, 73, 74, 78, 74, 73, 69, 73] }, // Bm9
  { pad: [55, 59, 62, 66, 67], bass: 31, arp: [71, 74, 78, 79, 78, 74, 71, 74] }, // Gmaj7
  { pad: [57, 62, 64, 67, 69], bass: 33, arp: [69, 74, 76, 79, 76, 74, 69, 73], resolve: [57, 61, 64, 66, 69] }, // Asus4 -> A6
];

/** Adds a sine-based note: env(t) shapes it, pan -1..1. */
function note(start, dur, freq, gain, pan, { attack = 0.01, release = 0.4, decay = 0, harm = 0, detune = 0, trem = 0 } = {}) {
  const s0 = Math.max(0, Math.floor(start * SR));
  const s1 = Math.min(N, Math.floor((start + dur + release) * SR));
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  const w = (2 * Math.PI * freq) / SR;
  const w2 = (2 * Math.PI * freq * (1 + detune)) / SR;
  for (let i = s0; i < s1; i++) {
    const t = i / SR - start;
    let env = t < attack ? t / attack : 1;
    if (decay) env *= Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    if (trem) env *= 1 - trem * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.2 * t));
    const k = i - s0;
    let v = Math.sin(w * k);
    if (detune) v = 0.5 * (v + Math.sin(w2 * k));
    if (harm) v += harm * Math.sin(2 * w * k) * Math.exp(-t / 0.5);
    L[i] += v * env * gl;
    R[i] += v * env * gr;
  }
}

const rounds = Math.ceil(SECONDS / (8 * BAR));
for (let r = 0; r < rounds; r++) {
  CHORDS.forEach((c, ci) => {
    const t0 = (r * 8 + ci * 2) * BAR;
    if (t0 >= SECONDS) return;
    // pad: slow swell over two bars, a little detuned for warmth
    c.pad.forEach((m, j) => note(t0, 2 * BAR - 0.4, hz(m), 0.045, -0.6 + (1.2 * j) / (c.pad.length - 1), { attack: 1.4, release: 1.6, detune: 0.0035 }));
    // bass: one soft note per bar
    for (let b = 0; b < 2; b++) note(t0 + b * BAR, BAR - 0.3, hz(c.bass), 0.11, 0, { attack: 0.08, release: 0.6, harm: 0.15 });
    // electric piano: beats 1 and 3, last bar of A resolves sus4 -> 3rd
    for (let b = 0; b < 4; b++) {
      const tones = b >= 2 && c.resolve ? c.resolve : c.pad;
      const at = t0 + b * 2 * BEAT;
      tones.slice(1).forEach((m, j) => note(at + j * 0.012, 1.6 * BEAT, hz(m + 12), 0.03, -0.3 + 0.15 * j, { attack: 0.006, decay: 1.1, release: 0.5, harm: 0.35, trem: 0.18 }));
    }
    // arpeggio (eighth notes), from the second round on, every other round softer
    if (r >= 1) {
      const g = r % 2 ? 0.022 : 0.015;
      for (let e = 0; e < 16; e++) note(t0 + e * (BEAT / 2), BEAT / 2, hz(c.arp[e % 8]), g, e % 2 ? 0.45 : -0.45, { attack: 0.005, decay: 0.32, release: 0.25, harm: 0.2 });
    }
  });
}

// one-pole low-pass to soften, then a stereo ping-pong echo (dotted eighth) for room
const lp = (x, a) => { let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } };
lp(L, 0.35);
lp(R, 0.35);
const d = Math.round(0.75 * BEAT * SR);
for (let i = d; i < N; i++) {
  L[i] += 0.28 * R[i - d];
  R[i] += 0.28 * L[i - d];
}

// fades and level: about -18 dBFS RMS in the file (the video mix lowers it further)
const fadeIn = 3 * SR;
const fadeOut = 5 * SR;
let sum = 0;
for (let i = 0; i < N; i++) {
  const f = Math.min(1, i / fadeIn, (N - i) / fadeOut);
  L[i] *= f;
  R[i] *= f;
  sum += L[i] * L[i] + R[i] * R[i];
}
const rms = Math.sqrt(sum / (2 * N));
const gain = 10 ** (-18 / 20) / rms;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2);
}
mkdirSync(dirname(out), { recursive: true });
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '160k', out], { input: pcm, maxBuffer: 1 << 26 });
if (r.status !== 0) throw new Error(String(r.stderr));
console.log(`music: ${out} (${SECONDS} s)`);

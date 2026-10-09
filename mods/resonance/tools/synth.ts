// Resonance's little synthesizer: pure functions, no Node and no `$`, so the
// generator script (tools/make-sounds.mjs, run by Node with type stripping)
// and the plugin's tests share it. Every voice is built from sines, FM pairs
// and noise shaped by envelopes, then written as 16-bit mono PCM WAV.

export const RATE = 22050

export type Recipe = { name: string; seconds: number; render: (t: number) => number }

const TAU = Math.PI * 2

/** Exponential decay that reaches about -60 dB after `t60` seconds. */
export function decay(t: number, t60: number): number {
  return t < 0 ? 0 : Math.exp((-6.9 * t) / Math.max(1e-4, t60))
}

/** A linear attack over `a` seconds, so nothing clicks at the onset. */
export function attack(t: number, a: number): number {
  return t < 0 ? 0 : t >= a ? 1 : t / a
}

/** A two-operator FM voice: carrier `fc`, modulator `fc * ratio`, index decaying. */
export function fm(t: number, fc: number, ratio: number, index: number, indexT60: number): number {
  const mod = Math.sin(TAU * fc * ratio * t) * index * decay(t, indexT60)
  return Math.sin(TAU * fc * t + mod)
}

/** Deterministic white noise in -1..1 (a hash of the sample index). */
export function noiseAt(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

/** One struck note starting at `start` seconds. */
function strike(t: number, start: number, f: number, t60: number, ratio = 3.5, index = 2.2): number {
  const u = t - start
  if (u < 0) return 0
  return fm(u, f, ratio, index, t60 * 0.35) * attack(u, 0.004) * decay(u, t60)
}

export const RECIPES: readonly Recipe[] = [
  {
    // A soft wooden click: a damped 1.9 kHz ping over a breath of noise.
    name: 'tick',
    seconds: 0.05,
    render: t => {
      const i = Math.round(t * RATE)
      return 0.55 * Math.sin(TAU * 1900 * t) * decay(t, 0.025) * attack(t, 0.0015) + 0.25 * noiseAt(i) * decay(t, 0.006)
    },
  },
  {
    // A rising C-major arpeggio of glassy FM bells, the last note held.
    name: 'chime',
    seconds: 1.3,
    render: t =>
      0.32 * strike(t, 0, 1046.5, 0.7) +
      0.3 * strike(t, 0.075, 1318.5, 0.7) +
      0.28 * strike(t, 0.15, 1568.0, 0.8) +
      0.34 * strike(t, 0.225, 2093.0, 1.1),
  },
  {
    // A rubbery downward bonk: a pitch dive with a thump of filtered noise.
    name: 'bonk',
    seconds: 0.32,
    render: t => {
      const f = 90 + 230 * Math.exp(-t * 22)
      const phase = TAU * (90 * t + (230 / 22) * (1 - Math.exp(-t * 22)))
      const body = Math.sin(phase + 1.4 * Math.sin(TAU * f * 0.5 * t) * decay(t, 0.08))
      return 0.8 * body * attack(t, 0.003) * decay(t, 0.28) + 0.18 * noiseAt(Math.round(t * RATE)) * decay(t, 0.02)
    },
  },
  {
    // A temple gong: inharmonic partials of 98 Hz, each fading at its own pace,
    // with a slow shimmer between the upper ones.
    name: 'gong',
    seconds: 2.6,
    render: t => {
      const f0 = 98
      const parts: [number, number, number][] = [[1, 0.5, 2.4], [1.47, 0.3, 1.9], [2.09, 0.22, 1.5], [2.56, 0.18, 1.2], [3.39, 0.12, 0.9], [4.17, 0.08, 0.7]]
      let s = 0
      for (const [r, a, t60] of parts) s += a * Math.sin(TAU * f0 * r * t + 0.6 * Math.sin(TAU * 0.7 * t * r)) * decay(t, t60)
      const shimmer = 1 + 0.12 * Math.sin(TAU * 4.3 * t)
      return 0.85 * s * shimmer * attack(t, 0.012)
    },
  },
  {
    // A small hand bell: FM with an inharmonic ratio, two strikes a fifth apart.
    name: 'bell',
    seconds: 1.2,
    render: t => 0.42 * strike(t, 0, 880, 0.9, 1.41, 3.2) + 0.32 * strike(t, 0.11, 1318.5, 0.8, 1.41, 2.6),
  },
  {
    // A polite alarm: four soft two-tone beeps, rounded square waves.
    name: 'alarm',
    seconds: 0.72,
    render: t => {
      const slot = Math.floor(t / 0.17)
      if (slot > 3) return 0
      const u = t - slot * 0.17
      if (u > 0.12) return 0
      const f = slot % 2 === 0 ? 880 : 660
      const sq = Math.tanh(3.2 * Math.sin(TAU * f * u))
      return 0.42 * sq * attack(u, 0.006) * (1 - attack(u - 0.1, 0.02))
    },
  },
]

/** Renders a recipe to samples, normalised to `peak`. */
export function renderRecipe(r: Recipe, peak = 0.8): Float32Array {
  const n = Math.max(1, Math.round(r.seconds * RATE))
  const out = new Float32Array(n)
  let max = 1e-9
  for (let i = 0; i < n; i++) {
    const v = r.render(i / RATE)
    out[i] = Number.isFinite(v) ? v : 0
    max = Math.max(max, Math.abs(out[i] ?? 0))
  }
  // A 4 ms fade-out so the last sample lands on silence.
  const fade = Math.min(n, Math.round(0.004 * RATE))
  for (let i = 0; i < n; i++) {
    const tail = n - 1 - i < fade ? (n - 1 - i) / fade : 1
    out[i] = ((out[i] ?? 0) / max) * peak * tail
  }
  return out
}

/** 16-bit mono PCM WAV bytes for the samples. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const dataBytes = samples.length * 2
  const buf = new Uint8Array(44 + dataBytes)
  const v = new DataView(buf.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return buf
}

export type WavHeader = { riff: string; wave: string; format: number; channels: number; rate: number; bits: number; dataBytes: number }

/** Reads back the canonical 44-byte header (for tests and the script's report). */
export function readWavHeader(bytes: Uint8Array): WavHeader {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const str = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n))
  return {
    riff: str(0, 4),
    wave: str(8, 4),
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    rate: v.getUint32(24, true),
    bits: v.getUint16(34, true),
    dataBytes: v.getUint32(40, true),
  }
}

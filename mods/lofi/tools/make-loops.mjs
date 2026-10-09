#!/usr/bin/env node
// Synthesizes Lofi's loops from nothing: warm chord pads, an FM electric piano,
// a round bass, a soft kick / rim / hat pattern with swing, tape wow and vinyl
// crackle. Every voice is written into a circular buffer (sample index modulo
// the loop length), so tails wrap into the start and each loop is seamless.
//
//   node tools/make-loops.mjs            writes sounds/{focus,deep,night,sunny}.wav
//
// 22.05 kHz, mono, 16-bit PCM. Deterministic: the same files every run.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 22050
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds')

// ---------------------------------------------------------------------------
// Moods. Chords are MIDI notes per bar (4 bars), bass is the root per bar.
// Patterns are 16 steps per bar: kick, rim, hat velocity (0 = rest).

const MOODS = {
  focus: {
    bpm: 78, swing: 0.58, cutoff: 3400, crackle: 0.55, echo: 0.28, keys: 0.9, pad: 0.7, seed: 11,
    chords: [[62, 65, 69, 72, 76], [55, 59, 64, 65, 69], [60, 64, 67, 71, 74], [57, 60, 64, 67, 71]],
    bass: [38, 31, 36, 33],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0],
    rim: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.3],
    hat: [0.6, 0, 0.35, 0, 0.6, 0, 0.35, 0, 0.6, 0, 0.35, 0, 0.6, 0, 0.35, 0.2],
    stabs: [0, 6, 10],
  },
  deep: {
    bpm: 68, swing: 0.6, cutoff: 2200, crackle: 0.7, echo: 0.36, keys: 0.55, pad: 1.0, seed: 23,
    chords: [[53, 56, 60, 63, 67], [49, 53, 56, 60, 63], [58, 61, 65, 68, 72], [48, 53, 55, 58, 62]],
    bass: [29, 25, 34, 24],
    kick: [1, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.9, 0, 0, 0, 0, 0],
    rim: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0.4, 0, 0, 0, 0.4, 0, 0.2, 0, 0.4, 0, 0, 0, 0.4, 0, 0.2, 0],
    stabs: [0, 10],
  },
  night: {
    bpm: 62, swing: 0.62, cutoff: 1800, crackle: 1.0, echo: 0.42, keys: 0.75, pad: 0.85, seed: 37,
    chords: [[51, 55, 58, 62, 65], [48, 51, 55, 58, 65], [56, 60, 63, 67, 74], [46, 51, 53, 56, 60]],
    bass: [27, 24, 32, 22],
    kick: [0.9, 0, 0, 0, 0, 0, 0, 0.45, 0, 0, 0.7, 0, 0, 0, 0, 0],
    rim: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0],
    hat: [0.3, 0, 0.18, 0, 0.3, 0, 0.18, 0, 0.3, 0, 0.18, 0, 0.3, 0, 0.18, 0],
    stabs: [0, 7],
  },
  sunny: {
    bpm: 86, swing: 0.56, cutoff: 5200, crackle: 0.4, echo: 0.22, keys: 1.0, pad: 0.5, seed: 41,
    chords: [[60, 64, 67, 71, 74], [52, 55, 59, 62, 67], [53, 57, 60, 64, 67], [55, 59, 62, 64, 69]],
    bass: [36, 40, 41, 43],
    kick: [1, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0.9, 0, 0, 0, 0, 0],
    rim: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0.5, 0.2, 0.4, 0.2, 0.5, 0.2, 0.4, 0.25, 0.5, 0.2, 0.4, 0.2, 0.5, 0.2, 0.4, 0.3],
    stabs: [0, 3, 6, 11, 14],
  },
}

// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hz = midi => 440 * 2 ** ((midi - 69) / 12)
const TAU = Math.PI * 2

/** Adds `fn(i)` for i in [0, len) at `start`, wrapping around the loop. */
function addAt(buf, start, len, fn) {
  const N = buf.length
  for (let i = 0; i < len; i++) buf[(start + i) % N] += fn(i)
}

/** One-pole low-pass, run twice around the loop so its state is settled at the seam. */
function lowpass(buf, cutoff) {
  const a = 1 - Math.exp((-TAU * cutoff) / SR)
  let y = 0
  const out = new Float32Array(buf.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buf.length; i++) {
      y += a * (buf[i] - y)
      if (pass === 1) out[i] = y
    }
  }
  return out
}

/** Feedback echo, circular: three trips around the loop settle the repeats. */
function echo(buf, delaySamples, feedback, mix) {
  const N = buf.length
  const wet = new Float32Array(N)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) wet[i] = buf[(i - delaySamples + N) % N] * 0.6 + wet[(i - delaySamples + N) % N] * feedback
  }
  const soft = lowpass(wet, 2400)
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) out[i] = buf[i] + soft[i] * mix
  return out
}

function render(name, m) {
  const beat = 60 / m.bpm
  const step = beat / 4
  const bar = beat * 4
  const N = Math.round(bar * 4 * SR)
  const r = rng(m.seed)
  const tonal = new Float32Array(N)
  const drums = new Float32Array(N)
  const duck = new Float32Array(N).fill(1)
  const noise = new Float32Array(N)

  // Tape wow: a slow pitch drift whose period divides the loop.
  const wowHz = Math.max(1, Math.round(0.45 * (N / SR))) / (N / SR)
  const wow = i => 1 + 0.0028 * Math.sin((TAU * wowHz * i) / SR) + 0.0009 * Math.sin((TAU * wowHz * 7 * i) / SR)
  // Swing: every off 16th is pushed late.
  const stepAt = s => Math.round(((s % 2 === 1 ? (s - 1) * step + 2 * step * m.swing : s * step)) * SR)

  for (let b = 0; b < 4; b++) {
    const barStart = Math.round(b * bar * SR)
    const chord = m.chords[b]

    // Pad: soft additive voices, two detuned copies each, slow attack, long release.
    for (const note of chord) {
      const f = hz(note)
      const len = Math.round((bar + 1.2) * SR)
      const att = 0.45 * SR
      const rel = 1.2 * SR
      const sus = bar * SR
      const ph = [r() * TAU, r() * TAU]
      addAt(tonal, barStart, len, i => {
        const env = i < att ? i / att : i < sus ? 1 : Math.max(0, 1 - (i - sus) / rel)
        const t = (i / SR) * wow(barStart + i)
        let s = 0
        for (const [d, p] of [[0.9977, ph[0]], [1.0023, ph[1]]]) {
          const w = TAU * f * d * t + p
          s += Math.sin(w) + 0.38 * Math.sin(2 * w) + 0.16 * Math.sin(3 * w) + 0.06 * Math.sin(4 * w)
        }
        return 0.022 * m.pad * env * env * s
      })
    }

    // Electric piano: two-operator FM, a bell-like attack that mellows.
    for (const s of m.stabs) {
      const at = barStart + stepAt(s)
      const vel = (s === 0 ? 1 : 0.7) * (0.85 + r() * 0.2)
      const len = Math.round(1.8 * SR)
      chord.forEach((note, k) => {
        const f = hz(note)
        const spread = Math.round(k * 0.012 * SR * (r() * 0.5 + 0.5))
        addAt(tonal, at + spread, len, i => {
          const t = (i / SR) * wow(at + i)
          const env = Math.exp(-t * 2.4) * Math.min(1, i / 60)
          const index = 1.6 * Math.exp(-t * 6)
          const mod = Math.sin(TAU * f * t) * index
          const tine = 0.12 * Math.sin(TAU * f * 14 * t) * Math.exp(-t * 30)
          return 0.03 * m.keys * vel * env * (Math.sin(TAU * f * t + mod) + tine)
        })
      })
    }

    // Bass: a round sine with a little second harmonic, on 1 and the swung 3-and.
    for (const [s, v] of [[0, 1], [10, 0.75]]) {
      const at = barStart + stepAt(s)
      const f = hz(m.bass[b] + 12)
      addAt(tonal, at, Math.round(1.1 * SR), i => {
        const t = i / SR
        const env = Math.exp(-t * 2.2) * Math.min(1, i / 120)
        return 0.16 * v * env * (Math.sin(TAU * f * t) + 0.25 * Math.sin(2 * TAU * f * t))
      })
    }

    // Drums.
    for (let s = 0; s < 16; s++) {
      const at = barStart + stepAt(s)
      const k = m.kick[s]
      if (k) {
        let phase = 0
        addAt(drums, at, Math.round(0.45 * SR), i => {
          const t = i / SR
          phase += (TAU * (44 + 76 * Math.exp(-t * 26))) / SR
          return 0.55 * k * Math.exp(-t * 7.5) * Math.sin(phase) + (i < 40 ? 0.05 * k * (r() - 0.5) : 0)
        })
        // The music leans away from the kick: a gentle pump.
        addAt(duck, at, Math.round(0.35 * SR), i => -0.28 * k * Math.exp(-(i / SR) * 9))
      }
      const rim = m.rim[s]
      if (rim) {
        let lp = 0
        addAt(drums, at, Math.round(0.18 * SR), i => {
          const t = i / SR
          lp += 0.35 * (r() * 2 - 1 - lp)
          return rim * Math.exp(-t * 32) * (0.12 * lp + 0.09 * Math.sin(TAU * 330 * t) * Math.exp(-t * 60))
        })
      }
      const hat = m.hat[s]
      if (hat) {
        let prev = 0
        const v = hat * (0.8 + r() * 0.3)
        addAt(drums, at, Math.round(0.06 * SR), i => {
          const n = r() * 2 - 1
          const hp = n - prev
          prev = n
          return 0.05 * v * Math.exp(-(i / SR) * 70) * hp
        })
      }
    }
  }

  // Vinyl: low hiss and sparse crackle pops of a sample or three.
  let hiss = 0
  for (let i = 0; i < N; i++) {
    hiss += 0.08 * (r() * 2 - 1 - hiss)
    noise[i] += 0.006 * m.crackle * hiss
    if (r() < 0.00055 * m.crackle) {
      const amp = (0.03 + r() * 0.1) * (r() < 0.5 ? -1 : 1)
      const w = 1 + Math.floor(r() * 3)
      for (let j = 0; j < w * 4; j++) noise[(i + j) % N] += amp * Math.exp(-j / w) * (j % 2 ? -0.6 : 1)
    }
  }
  // A slow rumble of the platter, period dividing the loop.
  const rumbleHz = Math.round(0.55 * (N / SR)) / (N / SR)
  for (let i = 0; i < N; i++) noise[i] += 0.004 * m.crackle * Math.sin((TAU * rumbleHz * i) / SR)

  // Mix: echo and warmth on the music, the pump, then everything through tape.
  let music = new Float32Array(N)
  for (let i = 0; i < N; i++) music[i] = tonal[i] * duck[i]
  music = echo(music, Math.round(step * 3 * SR), m.echo, 0.45)
  music = lowpass(music, m.cutoff)
  const kit = lowpass(drums, Math.min(7000, m.cutoff * 1.8))
  const crackle = lowpass(noise, 6000)
  const mix = new Float32Array(N)
  let peak = 0
  for (let i = 0; i < N; i++) {
    const x = Math.tanh((music[i] + kit[i]) * 1.4) + crackle[i]
    mix[i] = x
    peak = Math.max(peak, Math.abs(x))
  }
  const gain = 0.72 / Math.max(1e-6, peak)
  const pcm = new Int16Array(N)
  for (let i = 0; i < N; i++) pcm[i] = Math.max(-32767, Math.min(32767, Math.round(mix[i] * gain * 32767)))
  return { pcm, seconds: N / SR }
}

function wav(pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

mkdirSync(OUT, { recursive: true })
for (const [name, mood] of Object.entries(MOODS)) {
  const { pcm, seconds } = render(name, mood)
  const file = join(OUT, `${name}.wav`)
  writeFileSync(file, wav(pcm))
  console.log(`${name.padEnd(6)} ${mood.bpm} bpm  ${seconds.toFixed(2)} s  ${(pcm.byteLength / 1024).toFixed(0)} KB  → sounds/${name}.wav`)
}

// Clawdling's pixel crab, pure and self-contained: the terminal surface
// module and the desktop flipbook both draw from `crabFrame`, so the two
// surfaces show the same animation. Every cycle repeats within 24 frames.
//
// The crab is 16 x 8 pixels on a 30 x 8 stage (a pixel is half a terminal
// cell, two stacked per cell). Letters name the palette:
//   W eye white   P pupil      s stalk / closed eye   R shell   H highlight
//   D shell shade c claw       a arm                  k leg     m mouth
//   b blush       G glasses    g glass glint          Y gold    J gem
//   h / i party-hat stripes    S / T scarf stripes    B bubble  q bubble outline  o bubble dot (dim)
//   O bubble dot (lit)         w sweat                F / f fan

export type Mood = 'idle' | 'working' | 'thinking' | 'sad' | 'hot' | 'sleepy' | 'dance' | 'love'
export type Acc = { hat: boolean; glasses: boolean; scarf: boolean; crown: boolean }
export type Mark = { x: number; row: number; ch: string; color: string }
export type Frame = { px: (string | null)[][]; marks: Mark[] }

export const STAGE_W = 30
export const STAGE_H = 8
export const PERIOD = 24

export const PALETTE: Record<string, string> = {
  W: '#ffffff', P: '#1f2937', s: '#9f1239', R: '#f05a3c', H: '#ffb4a2', D: '#b8322a',
  c: '#e2412f', a: '#c53a2c', k: '#8c2a22', m: '#4a0f0b', b: '#fda4af',
  G: '#111827', g: '#93c5fd', Y: '#fbbf24', J: '#22d3ee', h: '#ec4899', i: '#a78bfa',
  S: '#14b8a6', T: '#99f6e4', B: '#f8fafc', q: '#94a3b8', o: '#cbd5e1', O: '#334155', w: '#7dd3fc', F: '#fde047', f: '#f59e0b',
}

const BODY = [
  '...WP......PW...',
  'cc..s......s..cc',
  'c...RRRRRRRR...c',
  'ccaRRHHRRRRRRacc',
  '...RRRRRRRRRR...',
  '...DRRRRRRRRD...',
  '....DDDDDDDD....',
  '................',
]

const LEGS_A: [number, number][] = [[2, 6], [13, 6], [1, 7], [3, 7], [12, 7], [14, 7]]
const LEGS_B: [number, number][] = [[3, 6], [12, 6], [2, 7], [4, 7], [11, 7], [13, 7]]

const LEFT_CLAW: [number, number, string][] = [[0, 1, 'c'], [1, 1, 'c'], [0, 2, 'c'], [0, 3, 'c'], [1, 3, 'c'], [2, 3, 'a']]
const RIGHT_CLAW: [number, number, string][] = LEFT_CLAW.map(([x, y, k]) => [15 - x, y, k])

function blank(): (string | null)[][] {
  return Array.from({ length: STAGE_H }, () => Array.from({ length: STAGE_W }, () => null as string | null))
}

/** A triangle wave 0..1..0 over `period` frames. */
function tri(f: number, period: number): number {
  const t = (((f % period) + period) % period) / period
  return t < 0.5 ? t * 2 : 2 - t * 2
}

export type FrameOpts = { mood: Mood; f: number; acc: Acc }

export function crabFrame({ mood, f: frame, acc }: FrameOpts): Frame {
  const f = ((frame % PERIOD) + PERIOD) % PERIOD
  const px = blank()
  const marks: Mark[] = []

  // Where the crab stands and how it holds itself.
  let ox = 4
  let leftClawDy = 0
  let rightClawDy = 0
  let legs = LEGS_A
  if (mood === 'idle') ox = 4 + (f < 12 ? 0 : 1)
  if (mood === 'working') {
    ox = Math.round(tri(f, PERIOD) * 10)
    legs = f % 2 === 0 ? LEGS_A : LEGS_B
    leftClawDy = f % 4 < 2 ? 0 : -1
    rightClawDy = f % 4 < 2 ? -1 : 0
  }
  if (mood === 'dance') {
    ox = 4 + (Math.floor(f / 3) % 2 === 0 ? -1 : 1)
    const up = Math.floor(f / 3) % 2 === 0
    leftClawDy = up ? -1 : 0
    rightClawDy = up ? 0 : -1
    legs = Math.floor(f / 3) % 2 === 0 ? LEGS_A : LEGS_B
  }
  if (mood === 'love') {
    leftClawDy = -1
    rightClawDy = -1
  }
  if (mood === 'hot') rightClawDy = f % 4 < 2 ? -1 : 0
  if (mood === 'sleepy') ox = 4
  if (mood === 'thinking') ox = 3

  // Every pixel drawn below lands on the stage: x + ox stays within 0..29
  // (the widest reach is the working scuttle's right claw, 15 + 10) and y
  // within 0..7 (a raised claw goes up to row 0).
  const put = (x: number, y: number, k: string | null) => {
    px[y]![x + ox] = k
  }

  // Body.
  BODY.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const k = line.charAt(x)
      if (k !== '.' && k !== 'c' && k !== 'a') put(x, y, k)
    }
  })
  for (const [x, y, k] of LEFT_CLAW) put(x, y + leftClawDy, k)
  for (const [x, y, k] of RIGHT_CLAW) put(x, y + rightClawDy, k)
  if (leftClawDy < 0) put(2, 2, 'a')
  if (rightClawDy < 0) put(13, 2, 'a')
  for (const [x, y] of legs) put(x, y, 'k')

  // Eyes: look around when idle, follow the scuttle, close, cry or hide behind shades.
  const blink = (mood === 'idle' || mood === 'thinking' || mood === 'dance') && f === 23
  const look: 'in' | 'left' | 'right' =
    mood === 'idle' ? (f < 8 ? 'in' : f < 16 ? 'left' : 'right')
      : mood === 'working' ? (f < PERIOD / 2 ? 'right' : 'left')
        : mood === 'thinking' ? 'right'
          : 'in'
  const closed = mood === 'sleepy' || blink || (mood === 'love' && f % 12 < 6)
  if (acc.glasses && !closed) {
    put(3, 0, 'G'); put(4, 0, f % 12 === 0 ? 'g' : 'G')
    put(11, 0, 'G'); put(12, 0, f % 12 === 6 ? 'g' : 'G')
  } else if (closed) {
    put(3, 0, 's'); put(4, 0, 's'); put(11, 0, 's'); put(12, 0, 's')
  } else if (mood === 'sad') {
    put(3, 0, 's'); put(4, 0, 'P'); put(11, 0, 'P'); put(12, 0, 's')
  } else {
    const lp = look === 'left' ? 3 : 4
    const rp = look === 'right' ? 12 : 11
    put(3, 0, 'W'); put(4, 0, 'W'); put(11, 0, 'W'); put(12, 0, 'W')
    put(lp, 0, 'P'); put(rp, 0, 'P')
  }

  // Mouth.
  const happy = mood === 'dance' || mood === 'love' || (mood === 'idle' && f >= 16)
  if (happy) {
    put(6, 4, 'm'); put(9, 4, 'm'); put(7, 5, 'm'); put(8, 5, 'm')
    put(4, 5, 'b'); put(11, 5, 'b')
  } else if (mood === 'sad') {
    put(7, 4, 'm'); put(8, 4, 'm'); put(6, 5, 'm'); put(9, 5, 'm')
  } else if (mood === 'hot') {
    put(7, 4, 'm'); put(8, 4, 'm'); put(7, 5, 'm'); put(8, 5, 'm')
  } else if (mood === 'sleepy') {
    put(7, 5, 'm')
  } else {
    put(7, 5, 'm'); put(8, 5, 'm')
  }

  // Headwear: the crown outranks the party hat.
  if (acc.crown) {
    for (const x of [5, 7, 8, 10]) put(x, 0, 'Y')
    for (const x of [5, 6, 9, 10]) put(x, 1, 'Y')
    put(7, 1, 'J'); put(8, 1, f % 8 < 4 ? 'J' : 'W')
  } else if (acc.hat) {
    put(7, 0, f % 6 < 3 ? 'Y' : 'W'); put(8, 0, 'h')
    put(6, 1, 'h'); put(7, 1, 'i'); put(8, 1, 'h'); put(9, 1, 'i')
  }
  if (acc.scarf) {
    for (let x = 4; x <= 11; x++) put(x, 6, x % 2 ? 'S' : 'T')
    put(12, 6, 'S')
    put(f % 8 < 4 ? 13 : 12, 7, 'T')
  }

  // Mood effects beside the crab.
  const side = ox + 17
  if (mood === 'thinking') {
    // A thought bubble with an outline, its three dots lighting in turn.
    put(16, 4, 'q')
    put(17, 3, 'q')
    for (let x = 19; x <= 25; x++) {
      put(x, 0, 'q')
      put(x, 1, 'B')
      put(x, 2, 'B')
      put(x, 3, 'q')
    }
    put(18, 1, 'q'); put(18, 2, 'q'); put(26, 1, 'q'); put(26, 2, 'q')
    const lit = Math.floor(f / 4) % 4
    for (const [i, x] of [[1, 20], [2, 22], [3, 24]] as const) {
      put(x, 1, lit >= i ? 'O' : 'o')
      put(x, 2, lit >= i ? 'O' : 'o')
    }
  }
  if (mood === 'sad') {
    // A sweat drop sliding down beside the head.
    const y = Math.floor(f / 6) % 4
    put(14, y, 'w')
    if (y > 0) put(14, y - 1, null)
  }
  if (mood === 'hot') {
    // Fanning with the right claw, drops flying off both sides.
    const up = f % 4 < 2
    if (up) {
      put(16, 0, 'F'); put(17, 0, 'f'); put(18, 0, 'F')
      put(16, 1, 'f'); put(17, 1, 'F')
    } else {
      put(17, 1, 'F'); put(18, 1, 'f'); put(19, 1, 'F')
      put(17, 2, 'f'); put(18, 2, 'F')
    }
    const d = Math.floor(f / 3) % 4
    put(-1 - d, 1 + (d % 3), 'w')
    put(1 - d, 0, 'w')
  }
  if (mood === 'sleepy') {
    const rise = Math.floor(f / 6) % 4
    marks.push({ x: side, row: Math.max(0, 3 - rise), ch: 'z', color: '#93c5fd' })
    if (rise >= 1) marks.push({ x: side + 2, row: Math.max(0, 3 - rise), ch: 'z', color: '#a5b4fc' })
    if (rise >= 2) marks.push({ x: side + 4, row: Math.max(0, 2 - rise + 1), ch: 'Z', color: '#c4b5fd' })
  }
  if (mood === 'dance') {
    const tw = ['✦', '✧', '⋆', '✶']
    const hues = ['#facc15', '#f472b6', '#22d3ee', '#a78bfa']
    for (let i = 0; i < 4; i++) {
      if ((f + i * 3) % 6 < 3) continue
      const x = i % 2 === 0 ? ox - 3 + i : ox + 17 + i
      marks.push({ x: Math.max(0, x), row: i % 3, ch: tw[(i + Math.floor(f / 6)) % tw.length]!, color: hues[i]! })
    }
    marks.push({ x: ox + 20, row: 1 + (Math.floor(f / 4) % 2), ch: f % 12 < 6 ? '♪' : '♫', color: '#f9a8d4' })
  }
  if (mood === 'love') {
    const hearts: [x: number, phase: number][] = [[ox + 17, 0], [ox + 19, 6], [ox - 2, 3], [ox + 21, 9]]
    hearts.forEach(([x, phase], i) => {
      const t = ((f + phase) % 12) / 12
      const row = 3 - Math.floor(t * 4) // 0..3: t is under 1
      marks.push({ x: Math.max(0, x), row, ch: '♥', color: i % 2 ? '#f472b6' : '#ef4444' })
    })
  }

  // Keep marks in empty cells only.
  const free = marks.filter(m => m.x >= 0 && m.x < STAGE_W && m.row >= 0 && m.row < STAGE_H / 2 && !px[m.row * 2]?.[m.x] && !px[m.row * 2 + 1]?.[m.x])
  return { px, marks: free }
}

// ---------------------------------------------------------------------------
// Terminal cells: two pixels per cell with the half blocks.

export type Run = { text: string; fg?: string; bg?: string }

/** Rows of runs (same fg/bg merged) for a frame: `▀` top over bottom, `▄` bottom alone. */
export function frameRuns(fr: Frame): Run[][] {
  const rows: Run[][] = []
  for (let r = 0; r < STAGE_H / 2; r++) {
    const runs: Run[] = []
    for (let x = 0; x < STAGE_W; x++) {
      const top = fr.px[r * 2]?.[x] ?? null
      const bot = fr.px[r * 2 + 1]?.[x] ?? null
      const mark = fr.marks.find(m => m.row === r && m.x === x)
      let cell: Run
      if (mark) cell = { text: mark.ch, fg: mark.color }
      else if (top && bot) cell = { text: '▀', fg: PALETTE[top], bg: PALETTE[bot] }
      else if (top) cell = { text: '▀', fg: PALETTE[top] }
      else if (bot) cell = { text: '▄', fg: PALETTE[bot] }
      else cell = { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else runs.push(cell)
    }
    rows.push(runs)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Desktop: the same frames as SVG paths, one path per color per frame.

export function frameSvg(fr: Frame, scale: number): string {
  const byColor = new Map<string, string>()
  for (let y = 0; y < STAGE_H; y++) {
    let x = 0
    const row = fr.px[y] ?? []
    while (x < STAGE_W) {
      const k = row[x]
      if (!k) {
        x++
        continue
      }
      let end = x + 1
      while (end < STAGE_W && row[end] === k) end++
      const d = `M${x * scale} ${y * scale}h${(end - x) * scale}v${scale}h${-(end - x) * scale}z`
      byColor.set(k, (byColor.get(k) ?? '') + d)
      x = end
    }
  }
  let out = ''
  for (const [k, d] of byColor) out += `<path fill="${PALETTE[k] ?? '#000'}" d="${d}"/>`
  for (const m of fr.marks) {
    out += `<text x="${(m.x + 0.5) * scale}" y="${(m.row * 2 + 1.6) * scale}" font-size="${scale * 2}" text-anchor="middle" fill="${m.color}" font-family="'Segoe UI Symbol','Apple Symbols',sans-serif">${m.ch}</text>`
  }
  return out
}

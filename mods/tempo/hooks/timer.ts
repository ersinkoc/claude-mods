// Tempo's clockwork, pure: phases, transitions, day keys and argument parsing.

export type Phase = 'work' | 'break' | 'long'

export type Timer = {
  phase: Phase
  startedAt: number
  endsAt: number
  workMin: number
  breakMin: number
  /** The focus round this phase belongs to, from 1. */
  round: number
}

export const MIN = 60_000
/** Every fourth focus round earns a long break, three short ones long. */
export const LONG_EVERY = 4

export function phaseMs(phase: Phase, workMin: number, breakMin: number): number {
  if (phase === 'work') return workMin * MIN
  return (phase === 'long' ? breakMin * 3 : breakMin) * MIN
}

export function startTimer(now: number, workMin = 25, breakMin = 5): Timer {
  return { phase: 'work', startedAt: now, endsAt: now + workMin * MIN, workMin, breakMin, round: 1 }
}

/** The phase after this one, starting at `at`. */
export function nextPhase(t: Timer, at: number): Timer {
  if (t.phase === 'work') {
    const phase: Phase = t.round % LONG_EVERY === 0 ? 'long' : 'break'
    return { ...t, phase, startedAt: at, endsAt: at + phaseMs(phase, t.workMin, t.breakMin) }
  }
  return { ...t, phase: 'work', round: t.round + 1, startedAt: at, endsAt: at + phaseMs('work', t.workMin, t.breakMin) }
}

/**
 * Moves the timer past every phase that ended by `now` (a machine asleep
 * through several), reporting each finished phase in order.
 */
export function catchUp(t: Timer, now: number): { timer: Timer; finished: Phase[] } {
  let cur = t
  const finished: Phase[] = []
  let guard = 0
  while (now >= cur.endsAt && guard++ < 64) {
    finished.push(cur.phase)
    cur = nextPhase(cur, cur.endsAt)
  }
  return { timer: cur, finished }
}

export function remainingMs(t: Timer, now: number): number {
  return Math.max(0, t.endsAt - now)
}

export function progressOf(t: Timer, now: number): number {
  const total = t.endsAt - t.startedAt
  return total <= 0 ? 1 : Math.max(0, Math.min(1, (now - t.startedAt) / total))
}

/** 25:00, 4:07; hours fold into minutes (90:00). */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The local calendar day of a timestamp: `2026-10-09`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Keeps only the most recent `keep` days of counts. */
export function pruneDays(days: Record<string, number>, keep = 60): Record<string, number> {
  const keys = Object.keys(days).sort().slice(-keep)
  const out: Record<string, number> = {}
  for (const k of keys) out[k] = days[k] ?? 0
  return out
}

export function phaseLabel(p: Phase): string {
  return p === 'work' ? 'Focus' : p === 'long' ? 'Long break' : 'Break'
}

export type StartArgs = { workMin: number; breakMin: number } | { error: string }

/** `start`, `start 50`, `start 50 10`, `start work=50 break=10`. */
export function parseStart(words: readonly string[]): StartArgs {
  let workMin = 25
  let breakMin = 5
  let positional = 0
  for (const w of words) {
    const m = /^(?:(work|break|w|b)=)?(\d+(?:\.\d+)?)$/i.exec(w)
    if (!m) return { error: `Could not read “${w}”. Try /tempo start 25 5` }
    const n = Number(m[2])
    const key = (m[1] ?? (positional++ === 0 ? 'work' : 'break')).toLowerCase()
    if (key.startsWith('w')) workMin = n
    else breakMin = n
  }
  if (!(workMin >= 1 && workMin <= 180)) return { error: 'Focus length must be 1–180 minutes.' }
  if (!(breakMin >= 1 && breakMin <= 60)) return { error: 'Break length must be 1–60 minutes.' }
  return { workMin, breakMin }
}

export function isTimer(v: unknown): v is Timer {
  if (!v || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return (t.phase === 'work' || t.phase === 'break' || t.phase === 'long') &&
    typeof t.startedAt === 'number' && typeof t.endsAt === 'number' &&
    typeof t.workMin === 'number' && typeof t.breakMin === 'number' && typeof t.round === 'number'
}

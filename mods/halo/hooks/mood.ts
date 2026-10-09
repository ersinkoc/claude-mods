// Halo's state machine: which mood the line shows, from plain facts. No `$`.
import type { HaloMood } from '../types'
import { KZ, toolColor } from './lib/kz.ts'

export const ERROR_MS = 4000
export const SPINNER_FRESH_MS = 2500

/** Tools whose call means Claude is waiting on the person. */
export const WAITING_TOOLS: readonly string[] = ['AskUserQuestion', 'ExitPlanMode']

export type StreamPhase = 'requesting' | 'thinking' | 'responding' | 'tool-input'
export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

export type MoodFacts = {
  now: number
  isWorking: boolean
  /** The newest running tool, if any (main loop or agent). */
  tool?: string
  /** A tool that waits on the person is running. */
  isWaiting: boolean
  failedAt?: number
  /** The main loop's model request as it streams, if one is in flight. */
  phase?: StreamPhase
  /** The spinner's mode as last drawn, and when. */
  spinner?: { mode: SpinnerMode; at: number }
}

export type Mood = { mood: HaloMood; color: string; label: string }

export const IDLE: Mood = { mood: 'idle', color: KZ.blue, label: '' }

/** Waiting beats a failure beats a running tool beats the model's own phase. */
export function moodOf(f: MoodFacts): Mood {
  if (f.isWaiting) return { mood: 'wait', color: KZ.amber, label: 'waiting for you' }
  if (f.failedAt !== undefined && f.now - f.failedAt < ERROR_MS) return { mood: 'error', color: KZ.red, label: 'tool failed' }
  if (f.tool) return { mood: 'tool', color: toolColor(f.tool), label: f.tool.startsWith('mcp__') ? f.tool.split('__').slice(1).join('·') : f.tool }
  if (!f.isWorking) return IDLE
  const fresh = f.spinner && f.now - f.spinner.at < SPINNER_FRESH_MS ? f.spinner.mode : undefined
  const phase = f.phase ?? fresh
  if (phase === 'thinking') return { mood: 'think', color: KZ.magenta, label: 'thinking' }
  if (phase === 'responding') return { mood: 'flow', color: KZ.violet, label: 'writing' }
  if (phase === 'tool-input' || phase === 'tool-use') return { mood: 'flow', color: KZ.violet, label: 'calling a tool' }
  return { mood: 'flow', color: KZ.violet, label: 'requesting' }
}

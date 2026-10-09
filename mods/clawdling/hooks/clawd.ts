// Clawdling's mind, pure: XP and levels, unlocks, which mood wins, and what it says.
import type { Acc, Mood } from './sprite.ts'

export const XP_TOOL = 1
export const XP_TURN = 10

/** XP needed to go from `level` to the next: 100, 200, 300, ... */
export function needFor(level: number): number {
  return 100 * Math.max(1, level)
}

/** Total XP at which `level` begins (Lv 1 at 0, Lv 2 at 100, Lv 3 at 300, ...). */
export function xpAtLevel(level: number): number {
  return (100 * (level - 1) * level) / 2
}

export function levelOf(xp: number): { level: number; into: number; need: number } {
  const total = Math.max(0, Math.floor(xp))
  let level = 1
  while (xpAtLevel(level + 1) <= total) level++
  return { level, into: total - xpAtLevel(level), need: needFor(level) }
}

export const UNLOCKS: readonly { level: number; key: keyof Acc; name: string; icon: string }[] = [
  { level: 3, key: 'hat', name: 'party hat', icon: '🎉' },
  { level: 5, key: 'glasses', name: 'sunglasses', icon: '😎' },
  { level: 8, key: 'scarf', name: 'scarf', icon: '🧣' },
  { level: 12, key: 'crown', name: 'crown', icon: '👑' },
]

export function accessoriesAt(level: number): Acc {
  return { hat: level >= 3, glasses: level >= 5, scarf: level >= 8, crown: level >= 12 }
}

/** The unlocks crossed going from one level to another. */
export function unlocksBetween(from: number, to: number): typeof UNLOCKS[number][] {
  return UNLOCKS.filter(u => u.level > from && u.level <= to)
}

export function nextUnlock(level: number): typeof UNLOCKS[number] | undefined {
  return UNLOCKS.find(u => u.level > level)
}

export type Senses = {
  now: number
  loveUntil: number
  sadUntil: number
  danceUntil: number
  ctxPercent: number
  limitPercent: number
  isTurnActive: boolean
  toolsRunning: number
}

/** The mood that wins, by priority: a treat, a fresh error, heat, sleepiness, work, thought, a party, rest. */
export function moodOf(s: Senses): Mood {
  if (s.now < s.loveUntil) return 'love'
  if (s.now < s.sadUntil) return 'sad'
  if (s.ctxPercent > 80) return 'hot'
  if (s.limitPercent > 90) return 'sleepy'
  if (s.isTurnActive) return s.toolsRunning > 0 ? 'working' : 'thinking'
  if (s.now < s.danceUntil) return 'dance'
  return 'idle'
}

export const MOOD_LABEL: Record<Mood, string> = {
  idle: 'lounging', working: 'scuttling', thinking: 'pondering', sad: 'ouch', hot: 'overheating',
  sleepy: 'drowsy', dance: 'celebrating', love: 'fed & happy',
}

export const QUIPS: Record<Mood, readonly string[]> = {
  idle: [
    'Tide’s calm. What are we building?',
    'I polished my shell while you were away.',
    'Sideways is still forwards, technically.',
    'Ready when you are, captain.',
    'Counting grains of sand. 4,021… 4,022…',
  ],
  working: [
    'Scuttling through your files!',
    'Pinch, pinch — tools at work.',
    'Carrying bytes, two claws at a time.',
    'Hold on, digging a tunnel in the codebase.',
    'Busy as a crab at low tide.',
  ],
  thinking: [
    'Hmm… let me chew on that.',
    'Bubbles mean thoughts. Lots of bubbles.',
    'Consulting the ancient sea scrolls…',
    'Thinking sideways, as one does.',
  ],
  sad: [
    'Oof. That one pinched back.',
    'A tool tripped. We’ll get it next wave.',
    'Ow, my claw. Let’s try again.',
    'Not every wave brings treasure.',
  ],
  hot: [
    'It’s getting crowded in this context…',
    'Phew! The window’s nearly full.',
    'Fanning myself. Maybe compact soon?',
    'My shell is steaming up in here.',
  ],
  sleepy: [
    'Five-hour limit nearly spent… so sleepy…',
    'Z z… wake me when the window resets.',
    'Running on fumes and seawater.',
  ],
  dance: [
    'Five in a row! Crab rave!',
    'Streak! Click-clack goes the dance floor.',
    'Look at us go — flawless tide!',
    'Shimmy shimmy, pinch pinch!',
  ],
  love: [
    'Nom! Thank you ♥',
    'Best snack in the whole ocean.',
    'My claws are full of gratitude.',
    'Crunchy plankton, my favorite!',
  ],
}

export function quipFor(mood: Mood, seed: number): string {
  const list = QUIPS[mood]
  return list[Math.abs(Math.floor(seed)) % list.length]! // every mood has quips
}

export function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, 24) : 'Pinchy'
}

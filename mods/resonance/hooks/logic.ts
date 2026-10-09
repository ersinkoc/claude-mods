// Resonance's decisions, pure: which sound an event makes under a profile,
// the tick throttle, and the rate-limit crossings that ring the alarm.

export const SOUNDS = ['tick', 'chime', 'bonk', 'gong', 'bell', 'alarm'] as const
export type Sound = (typeof SOUNDS)[number]
export type Profile = 'subtle' | 'arcade' | 'silent'

/** Which sounds each profile lets through. */
export const PROFILES: Record<Profile, readonly Sound[]> = {
  subtle: ['chime', 'bonk', 'gong', 'bell', 'alarm'],
  arcade: ['tick', 'chime', 'bonk', 'gong', 'bell', 'alarm'],
  silent: [],
}

export function profileOf(v: unknown): Profile {
  return v === 'arcade' || v === 'silent' ? v : 'subtle'
}

export function isAllowed(profile: Profile, s: Sound): boolean {
  return PROFILES[profile].includes(s)
}

/** Minimum gap between two plays of the same sound, in ms. */
export const GAP: Record<Sound, number> = { tick: 400, chime: 0, bonk: 700, gong: 1500, bell: 900, alarm: 3000 }

/** True when a sound last played at `last` may play again at `now`. */
export function canPlay(s: Sound, last: number | undefined, now: number): boolean {
  return last === undefined || now - last >= GAP[s]
}

/** Gain from a 0..100 volume (the engine takes 0..4; we stay at or under 1). */
export function gainOf(volume: unknown): number {
  const v = typeof volume === 'number' && Number.isFinite(volume) ? volume : 70
  return Math.max(0, Math.min(100, v)) / 100
}

export const THRESHOLDS = [80, 95] as const

/**
 * The thresholds each window crossed since it was last seen. `seen` holds,
 * per window kind, the highest threshold already announced; a window that
 * fell back under the first threshold (a reset) is forgotten so its next
 * climb rings again.
 */
export function crossings(
  seen: Readonly<Record<string, number>>,
  limits: readonly { kind: string; percentUsed: number }[],
): { alerts: { kind: string; threshold: number; percent: number }[]; seen: Record<string, number> } {
  const next: Record<string, number> = { ...seen }
  const alerts: { kind: string; threshold: number; percent: number }[] = []
  for (const l of limits) {
    const had = next[l.kind] ?? 0
    const top = THRESHOLDS.filter(t => l.percentUsed >= t).pop() ?? 0
    if (top > had) alerts.push({ kind: l.kind, threshold: top, percent: l.percentUsed })
    next[l.kind] = l.percentUsed < (THRESHOLDS[0] ?? 80) ? 0 : Math.max(had, top)
  }
  return { alerts, seen: next }
}

/** A short spoken-free description for `/resonance` replies. */
export function describeProfile(p: Profile): string {
  const on = PROFILES[p]
  return on.length ? `${p}: ${on.join(', ')}` : `${p}: nothing plays`
}

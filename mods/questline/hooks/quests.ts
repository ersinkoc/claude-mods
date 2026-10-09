// Questline's bookkeeping: pure functions over the quest list, no `$`.
import type { Quest, QuestStatus } from '../types'

/** After everything is done the band lingers this long, then hides. */
export const LINGER_MS = 120_000

export type Todo = { content?: unknown; status?: unknown; activeForm?: unknown }

const statusOf = (v: unknown): QuestStatus => (v === 'completed' || v === 'in_progress' ? v : 'pending')
const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

/** A TodoWrite list replaces the todo quests; a row keeps its start time when it stays in progress. */
export function fromTodos(prev: readonly Quest[], todos: readonly Todo[], now: number): Quest[] {
  return todos.map((t, i) => {
    const title = text(t.content, `Step ${i + 1}`)
    const status = statusOf(t.status)
    const before = prev.find(q => q.title === title) ?? prev[i]
    const since = status === 'in_progress' ? (before?.status === 'in_progress' && before.title === title ? before.since ?? now : now) : undefined
    return { id: `todo:${i}`, title, active: text(t.activeForm, title), status, ...(since !== undefined ? { since } : {}) }
  })
}

export function createTask(list: readonly Quest[], id: string, subject: string, activeForm: string | undefined): Quest[] {
  const key = `task:${id}`
  if (list.some(q => q.id === key)) return [...list]
  return [...list, { id: key, title: subject, active: activeForm?.trim() || subject, status: 'pending' }]
}

export type TaskPatch = { taskId: string; status?: string; subject?: string; activeForm?: string }

export function updateTask(list: readonly Quest[], patch: TaskPatch, now: number): Quest[] {
  const key = `task:${patch.taskId}`
  if (patch.status === 'deleted') return list.filter(q => q.id !== key)
  const found = list.find(q => q.id === key)
  const base: Quest = found ?? { id: key, title: patch.subject || `Task #${patch.taskId}`, active: patch.activeForm || patch.subject || `Task #${patch.taskId}`, status: 'pending' }
  const status = patch.status === undefined ? base.status : statusOf(patch.status)
  const next: Quest = {
    id: key,
    title: patch.subject || base.title,
    active: patch.activeForm || (patch.subject && base.active === base.title ? patch.subject : base.active),
    status,
  }
  if (status === 'in_progress') next.since = base.status === 'in_progress' ? base.since ?? now : now
  return found ? list.map(q => (q.id === key ? next : q)) : [...list, next]
}

export type Progress = { done: number; total: number; active: Quest | undefined }

export function progress(list: readonly Quest[]): Progress {
  const active = list.find(q => q.status === 'in_progress')
  return { done: list.filter(q => q.status === 'completed').length, total: list.length, active }
}

/** Shown while there is a task, until two minutes after everything completed. */
export function isShown(list: readonly Quest[], allDoneAt: number | null, now: number): boolean {
  if (!list.length) return false
  const { done, total } = progress(list)
  if (done < total) return true
  return allDoneAt === null || now - allDoneAt < LINGER_MS
}

/** A coarse elapsed label that changes rarely: <10s, 20s, ..., 4m, 1h12m. */
export function coarseSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 10) return '<10s'
  if (s < 60) return `${Math.floor(s / 10) * 10}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** Segment widths for `n` quests in `budget` cells: equal, at most 6, with a gap when there is room. */
export function segments(n: number, budget: number): { width: number; gap: number } {
  if (n <= 0) return { width: 0, gap: 0 }
  const withGap = Math.floor((budget + 1) / n) - 1
  if (withGap >= 2) return { width: Math.min(6, withGap), gap: 1 }
  return { width: Math.max(1, Math.floor(budget / n)), gap: 0 }
}

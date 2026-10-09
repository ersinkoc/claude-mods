// Laurels' badge book, pure: the facts a session gathers, the badges read
// over them, and the small classifiers the hooks feed them with.

export type Flag =
  | 'nightOwl' | 'earlyBird' | 'weekend' | 'pennyPincher' | 'cacheWizard' | 'contextSurfer'
  | 'bugSquasher' | 'speedDemon' | 'committed' | 'pushed' | 'testPilot' | 'undaunted'
  | 'deepThinker' | 'haiku' | 'cleanSlate' | 'labNotes'

export type Facts = {
  /** This session. */
  turns: number
  tools: number
  fails: number
  reads: number
  searches: number
  web: number
  agents: number
  maxRunning: number
  costUsd: number
  sessionMs: number
  tokens: number
  exts: string[]
  mcpServers: string[]
  bestFilesInTurn: number
  flags: Partial<Record<Flag, true>>
  /** Every session, kept in $.store. */
  life: Lifetime
}

export type Lifetime = { turns: number; tools: number; tasksDone: number; days: string[] }

export function emptyLife(): Lifetime {
  return { turns: 0, tools: 0, tasksDone: 0, days: [] }
}

export function emptyFacts(life: Lifetime = emptyLife()): Facts {
  return {
    turns: 0, tools: 0, fails: 0, reads: 0, searches: 0, web: 0, agents: 0, maxRunning: 0,
    costUsd: 0, sessionMs: 0, tokens: 0, exts: [], mcpServers: [], bestFilesInTurn: 0, flags: {}, life,
  }
}

export type Badge = {
  id: string
  name: string
  glyph: string
  color: string
  /** What it is for, shown once unlocked. */
  desc: string
  /** How to get it, shown while locked. */
  hint: string
  /** The toast's flourish: `🏆 Hydra unlocked — <cheer>`. */
  cheer: string
  /** Counter badges show a progress bar toward `goal`; flag badges have goal 1. */
  goal: number
  value: (f: Facts) => number
}

const flag = (k: Flag) => (f: Facts) => (f.flags[k] ? 1 : 0)

export const BADGES: readonly Badge[] = [
  { id: 'first-light', name: 'First Light', glyph: '✦', color: '#facc15', desc: 'Finished your very first turn.', hint: 'Finish a turn.', cheer: 'the first of many', goal: 1, value: f => Math.min(1, f.life.turns) },
  { id: 'hydra', name: 'Hydra', glyph: '🐉', color: '#a78bfa', desc: 'Five subagents running at once.', hint: 'Have five subagents running at the same time.', cheer: 'five agents at once', goal: 5, value: f => f.maxRunning },
  { id: 'delegator', name: 'Delegator', glyph: '◈', color: '#c084fc', desc: 'Ten subagents in one session.', hint: 'Spawn ten subagents in a session.', cheer: 'ten agents dispatched', goal: 10, value: f => f.agents },
  { id: 'night-owl', name: 'Night Owl', glyph: '🦉', color: '#818cf8', desc: 'A turn between midnight and 5 a.m.', hint: 'Work between 00:00 and 05:00.', cheer: 'the moon approves', goal: 1, value: flag('nightOwl') },
  { id: 'early-bird', name: 'Early Bird', glyph: '🌅', color: '#fb923c', desc: 'A turn between 5 and 7 a.m.', hint: 'Work between 05:00 and 07:00.', cheer: 'up before the sun', goal: 1, value: flag('earlyBird') },
  { id: 'weekend-warrior', name: 'Weekend Warrior', glyph: '⚔', color: '#f472b6', desc: 'Shipped work on a weekend.', hint: 'Finish a turn on Saturday or Sunday.', cheer: 'no days off', goal: 1, value: flag('weekend') },
  { id: 'marathon', name: 'Marathon', glyph: '🏃', color: '#34d399', desc: 'A session two hours long.', hint: 'Keep one session going for two hours.', cheer: 'two hours in the saddle', goal: 120, value: f => Math.floor(f.sessionMs / 60_000) },
  { id: 'big-spender', name: 'Big Spender', glyph: '💎', color: '#22d3ee', desc: 'A ten-dollar session.', hint: 'Spend $10 in one session.', cheer: 'ten dollars of thought', goal: 10, value: f => Math.floor(f.costUsd * 100) / 100 },
  { id: 'penny-pincher', name: 'Penny Pincher', glyph: '🪙', color: '#eab308', desc: 'Ten tools in one turn for under five cents.', hint: 'Run ten tools in a turn that costs under $0.05.', cheer: 'thrift, perfected', goal: 1, value: flag('pennyPincher') },
  { id: 'cache-wizard', name: 'Cache Wizard', glyph: '🧙', color: '#60a5fa', desc: 'Cache reads over 90% of a turn’s input.', hint: 'Have a turn read over 90% of its input from cache.', cheer: 'the cache remembers', goal: 1, value: flag('cacheWizard') },
  { id: 'context-surfer', name: 'Context Surfer', glyph: '🏄', color: '#2dd4bf', desc: 'Kept going past 90% context.', hint: 'Start a turn with the context over 90% full.', cheer: 'riding the edge of the window', goal: 1, value: flag('contextSurfer') },
  { id: 'bug-squasher', name: 'Bug Squasher', glyph: '🐞', color: '#4ade80', desc: 'A failing command, fixed: the same command later passed.', hint: 'Make a failing shell command pass.', cheer: 'red to green', goal: 1, value: flag('bugSquasher') },
  { id: 'polyglot', name: 'Polyglot', glyph: '🗺', color: '#f59e0b', desc: 'Edited five kinds of file in one session.', hint: 'Edit files with five different extensions.', cheer: 'five tongues spoken', goal: 5, value: f => f.exts.length },
  { id: 'speed-demon', name: 'Speed Demon', glyph: '⚡', color: '#fde047', desc: 'Three tools in a turn under ten seconds.', hint: 'Finish a turn with 3+ tools in under 10 s.', cheer: 'blink and it’s done', goal: 1, value: flag('speedDemon') },
  { id: 'centurion', name: 'Centurion', glyph: '🛡', color: '#f87171', desc: 'A hundred tool calls in one session.', hint: 'Make 100 tool calls in a session.', cheer: 'a hundred strikes', goal: 100, value: f => f.tools },
  { id: 'architect', name: 'Architect', glyph: '🏛', color: '#fbbf24', desc: 'Wrote ten files in a single turn.', hint: 'Write or edit ten files in one turn.', cheer: 'ten files raised at once', goal: 10, value: f => f.bestFilesInTurn },
  { id: 'archaeologist', name: 'Archaeologist', glyph: '🏺', color: '#d97757', desc: 'Fifty reads in one session.', hint: 'Read 50 files in a session.', cheer: 'fifty layers deep', goal: 50, value: f => f.reads },
  { id: 'needle', name: 'Needle Finder', glyph: '⌕', color: '#93c5fd', desc: 'Twenty-five searches in one session.', hint: 'Run 25 Grep or Glob searches.', cheer: 'found it, every time', goal: 25, value: f => f.searches },
  { id: 'committed', name: 'Committed', glyph: '⎇', color: '#22c55e', desc: 'A successful git commit.', hint: 'Commit with git from the shell.', cheer: 'history written', goal: 1, value: flag('committed') },
  { id: 'shipwright', name: 'Shipwright', glyph: '⛵', color: '#38bdf8', desc: 'A successful git push.', hint: 'Push with git from the shell.', cheer: 'shipped', goal: 1, value: flag('pushed') },
  { id: 'test-pilot', name: 'Test Pilot', glyph: '🧪', color: '#a3e635', desc: 'A test run that passed.', hint: 'Run the tests and see them pass.', cheer: 'all green', goal: 1, value: flag('testPilot') },
  { id: 'taskmaster', name: 'Taskmaster', glyph: '☑', color: '#14b8a6', desc: 'Ten tasks finished.', hint: 'Complete ten todos or tasks.', cheer: 'ten boxes ticked', goal: 10, value: f => f.life.tasksDone },
  { id: 'web-crawler', name: 'Web Crawler', glyph: '🕸', color: '#06b6d4', desc: 'Ten web searches or fetches in a session.', hint: 'Search or fetch the web ten times.', cheer: 'the web, combed', goal: 10, value: f => f.web },
  { id: 'switchboard', name: 'Switchboard', glyph: '⬡', color: '#e879f9', desc: 'Tools from three MCP servers in one session.', hint: 'Use tools of three different MCP servers.', cheer: 'all lines connected', goal: 3, value: f => f.mcpServers.length },
  { id: 'undaunted', name: 'Undaunted', glyph: '🔥', color: '#ef4444', desc: 'Five failures in a turn, and it still finished.', hint: 'Push through five failed tools in one turn.', cheer: 'nothing stops you', goal: 1, value: flag('undaunted') },
  { id: 'deep-thinker', name: 'Deep Thinker', glyph: '🌀', color: '#8b5cf6', desc: 'A single turn of ten minutes or more.', hint: 'Let one turn run ten minutes.', cheer: 'ten minutes of focus', goal: 1, value: flag('deepThinker') },
  { id: 'haiku', name: 'Haiku', glyph: '🍃', color: '#86efac', desc: 'An answer in under five seconds, no tools.', hint: 'Get a tool-free answer in under 5 s.', cheer: 'brevity is wit', goal: 1, value: flag('haiku') },
  { id: 'clean-slate', name: 'Clean Slate', glyph: '✧', color: '#e5e7eb', desc: 'Twenty tool calls in a session, not one failed.', hint: 'Make 20 tool calls without a single failure.', cheer: 'flawless', goal: 1, value: flag('cleanSlate') },
  { id: 'token-tsunami', name: 'Token Tsunami', glyph: '🌊', color: '#3b82f6', desc: 'A million tokens through one session.', hint: 'Move a million tokens in a session.', cheer: 'a million tokens', goal: 1_000_000, value: f => f.tokens },
  { id: 'lab-notes', name: 'Lab Notes', glyph: '📓', color: '#fcd34d', desc: 'Edited a Jupyter notebook.', hint: 'Edit a notebook cell.', cheer: 'science, documented', goal: 1, value: flag('labNotes') },
  { id: 'devotee', name: 'Devotee', glyph: '📅', color: '#f97316', desc: 'Worked on seven different days.', hint: 'Finish turns on seven different days.', cheer: 'a week of devotion', goal: 7, value: f => f.life.days.length },
  { id: 'regular', name: 'Regular', glyph: '♛', color: '#eab308', desc: 'A hundred turns, all sessions together.', hint: 'Finish 100 turns in all.', cheer: 'one hundred turns', goal: 100, value: f => f.life.turns },
]

export function badgeById(id: string): Badge | undefined {
  return BADGES.find(b => b.id === id)
}

/** Badges whose value reached the goal and are not yet in `unlocked`. */
export function newlyUnlocked(f: Facts, unlocked: Readonly<Record<string, number>>): Badge[] {
  return BADGES.filter(b => unlocked[b.id] === undefined && b.value(f) >= b.goal)
}

/** Each counter badge's value, capped at its goal (for progress bars). */
export function progressOf(f: Facts): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of BADGES) out[b.id] = Math.min(b.goal, Math.max(0, b.value(f)))
  return out
}

// ---------------------------------------------------------------------------
// Turn-level checks.

export type TurnFacts = {
  startedAt: number
  durationMs: number
  tools: number
  fails: number
  files: number
  steps: number
  estUsd: number
  input: number
  cacheRead: number
  cacheWrite: number
  reason: string
}

/** The flags one finished main turn earns; `hour` and `weekday` are local. */
export function turnFlags(t: TurnFacts, hour: number, weekday: number): Flag[] {
  const out: Flag[] = []
  const answered = t.reason === 'answer'
  if (hour >= 0 && hour < 5) out.push('nightOwl')
  if (hour >= 5 && hour < 7) out.push('earlyBird')
  if (weekday === 0 || weekday === 6) out.push('weekend')
  if (answered && t.tools >= 3 && t.durationMs < 10_000) out.push('speedDemon')
  if (answered && t.tools >= 10 && t.steps > 0 && t.estUsd < 0.05) out.push('pennyPincher')
  const inTotal = t.input + t.cacheRead + t.cacheWrite
  if (inTotal >= 10_000 && t.cacheRead / inTotal > 0.9) out.push('cacheWizard')
  if (t.durationMs >= 10 * 60_000) out.push('deepThinker')
  if (answered && t.tools === 0 && t.durationMs < 5000) out.push('haiku')
  if (answered && t.fails >= 5) out.push('undaunted')
  return out
}

// ---------------------------------------------------------------------------
// Classifiers for tool calls.

export function normCommand(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim()
}

export function isGitCommit(cmd: string): boolean {
  return /(^|[;&|]\s*)git(\s+-\S+(\s+\S+)?)*\s+commit\b/.test(normCommand(cmd))
}

export function isGitPush(cmd: string): boolean {
  return /(^|[;&|]\s*)git(\s+-\S+(\s+\S+)?)*\s+push\b/.test(normCommand(cmd))
}

export function isTestRun(cmd: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|vitest|jest|mocha|rspec|phpunit)\b|\b(cargo|go|dotnet|mix|deno|bun)\s+test\b|\bclaude\s+plugin\s+test\b|\bmake\s+(test|check)\b|\bgradle\w*\s+test\b|\bmvn\s+test\b/.test(cmd)
}

/** `.tsx` from `src/app.tsx`; '' for none (Makefile). */
export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

export function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  return tool.split('__')[1] || undefined
}

/** Todos newly marked completed between two TodoWrite lists (by content). */
export function todosDone(before: readonly { content: string; status: string }[], after: readonly { content: string; status: string }[]): number {
  const was = new Set(before.filter(t => t.status === 'completed').map(t => t.content))
  return after.filter(t => t.status === 'completed' && !was.has(t.content)).length
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sanitizeLife(v: unknown): Lifetime {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : 0)
  return {
    turns: n('turns'),
    tools: n('tools'),
    tasksDone: n('tasksDone'),
    days: Array.isArray(o.days) ? (o.days as unknown[]).filter((d): d is string => typeof d === 'string').slice(-60) : [],
  }
}

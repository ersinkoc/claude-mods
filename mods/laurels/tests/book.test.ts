import { describe, expect, test } from 'claude-code/testing'

import { BADGES, badgeById, dayKey, emptyFacts, extOf, isGitCommit, isGitPush, isTestRun, mcpServerOf, progressOf, sanitizeLife, todosDone, turnFlags } from '../hooks/badges.ts'

describe('classifiers', () => {
  test('installing, searching or a dry run earns nothing; the real command still does', () => {
    for (const c of ['npm install -D vitest', 'pip install pytest', 'npm uninstall jest', 'grep -rn jest src', 'which pytest', 'git commit -m "add jest"', 'CI=1 npm install jest', 'sudo npm i -g mocha']) expect(isTestRun(c), c).toBe(false)
    for (const c of ['npm test', 'npx vitest run', 'pytest -q', 'npm install && npm test', 'npm i vitest\nnpx vitest run', 'FOO=1 pytest', 'grep foo x | npx jest']) expect(isTestRun(c), c).toBe(true)
    for (const c of ['git push --dry-run', 'git push -n origin main', 'git push -un origin main', 'echo git push']) expect(isGitPush(c), c).toBe(false)
    for (const c of ['git push', 'git push -u origin x', 'git push --dry-run && git push', 'git status; git push']) expect(isGitPush(c), c).toBe(true)
    for (const c of ['git commit --dry-run', 'git -C r commit --dry-run -a', 'echo "git commit"']) expect(isGitCommit(c), c).toBe(false)
    for (const c of ['git commit -n -m x', 'git commit --dry-run && git commit -m x', 'git add . && git commit -m x']) expect(isGitCommit(c), c).toBe(true)
  })

  test('file extensions, either slash, none for dotfiles or bare names', () => {
    expect(extOf('src/app.TSX')).toBe('.tsx')
    expect(extOf('C:\\work\\notes.md')).toBe('.md')
    expect(extOf('Makefile')).toBe('')
    expect(extOf('/home/me/.bashrc')).toBe('')
    expect(extOf('')).toBe('')
  })

  test('MCP servers from tool names', () => {
    expect(mcpServerOf('mcp__github__create_issue')).toBe('github')
    expect(mcpServerOf('mcp__')).toBeUndefined()
    expect(mcpServerOf('Read')).toBeUndefined()
  })

  test('todos newly done: one done before is not counted again', () => {
    const before = [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }]
    const after = [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }, { content: 'c', status: 'in_progress' }]
    expect(todosDone(before, after)).toBe(1)
  })

  test('a turn of an aborted answer earns no answer badges', () => {
    const t = { startedAt: 0, durationMs: 1000, tools: 12, fails: 6, files: 0, steps: 1, estUsd: 0.01, input: 0, cacheRead: 0, cacheWrite: 0, reason: 'aborted' }
    expect(turnFlags(t, 12, 3)).toEqual([])
    // Cache share needs ten thousand input tokens.
    expect(turnFlags({ ...t, input: 10, cacheRead: 990 }, 12, 3)).toEqual([])
    // Penny pincher needs a step priced.
    expect(turnFlags({ ...t, reason: 'answer', steps: 0, fails: 0, durationMs: 20_000 }, 12, 3)).toEqual([])
    expect(turnFlags({ ...t, reason: 'answer', fails: 0, durationMs: 20_000, estUsd: 0.06 }, 12, 3)).toEqual([])
    expect(turnFlags({ ...t, reason: 'answer', fails: 0, tools: 2, durationMs: 20_000 }, 7, 1)).toEqual([])
  })
})

describe('the book', () => {
  test('lookup, progress capped at each goal, the day key', () => {
    expect(badgeById('hydra')?.name).toBe('Hydra')
    expect(badgeById('nope')).toBeUndefined()
    const f = emptyFacts()
    f.maxRunning = 9
    f.tools = 3
    f.costUsd = 12.345
    f.sessionMs = 3 * 3600_000
    f.flags.committed = true
    const p = progressOf(f)
    expect(p.hydra).toBe(5)
    expect(p.centurion).toBe(3)
    expect(p['big-spender']).toBe(10)
    expect(p.marathon).toBe(120)
    expect(p.committed).toBe(1)
    expect(Object.keys(p)).toHaveLength(BADGES.length)
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })

  test('a stored lifetime is read defensively', () => {
    expect(sanitizeLife(null)).toEqual({ turns: 0, tools: 0, tasksDone: 0, days: [] })
    expect(sanitizeLife('x')).toEqual({ turns: 0, tools: 0, tasksDone: 0, days: [] })
    expect(sanitizeLife({ turns: 4, tools: Number.POSITIVE_INFINITY, tasksDone: '3', days: ['2026-01-01', 7] })).toEqual({ turns: 4, tools: 0, tasksDone: 0, days: ['2026-01-01'] })
    const days = Array.from({ length: 70 }, (_, i) => `d${i}`)
    expect(sanitizeLife({ days }).days).toEqual(days.slice(-60))
    expect(sanitizeLife({ days: 'x' }).days).toEqual([])
  })
})

import { describe, expect, test } from 'claude-code/testing'

import { addTool, addUsage, familyOf, fileList, newTally, summaryPrompt, toRecap, writtenFile } from '../hooks/recap.ts'

describe('recap edges', () => {
  test('every family has its tools', async () => {
    expect(['Agent', 'Task', 'Workflow', 'SendMessage'].map(familyOf)).toEqual(['agent', 'agent', 'agent', 'agent'])
    expect(['WebFetch', 'WebSearch'].map(familyOf)).toEqual(['web', 'web'])
    expect(['TaskCreate', 'TodoWrite'].map(familyOf)).toEqual(['tasks', 'tasks'])
    expect(['Glob', 'LSP', 'PowerShell', 'Monitor', 'MultiEdit'].map(familyOf)).toEqual(['read', 'read', 'shell', 'shell', 'edit'])
    expect(familyOf('ExitPlanMode')).toBe('other')
  })

  test('the file a call writes: a notebook by its path, nothing for an empty or odd path', async () => {
    expect(writtenFile('NotebookEdit', { notebook_path: '/w/a.ipynb' })).toBe('/w/a.ipynb')
    expect(writtenFile('Write', { file_path: '' })).toBeUndefined()
    expect(writtenFile('Edit', { file_path: 42 })).toBeUndefined()
    expect(writtenFile('Read', { file_path: '/w/a.ts' })).toBeUndefined()
  })

  test('usage adds up with missing figures as 0 and no usage at all as nothing', async () => {
    const t = newTally('t', 0, 'x')
    addUsage(t, 'claude-opus-5-5', null)
    expect(t.steps).toBe(0)
    addUsage(t, 'claude-opus-5-5', { output_tokens: 100 })
    expect(t.usage).toEqual({ input_tokens: 0, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    expect(t.steps).toBe(1)
    addUsage(t, 'claude-opus-5-5', { input_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 })
    expect(t.usage).toEqual({ input_tokens: 7, output_tokens: 100, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 })
  })

  test('a recap without a cost reading has no session delta; the prompt is one trimmed line', async () => {
    const t = newTally('t', 0, '  fix\n\n the   bug  ')
    addTool(t, 'Read', { file_path: '/w/a.ts' }, false, 'a.ts')
    const r = toRecap(t, 10, 5, 'answer')
    expect(r.prompt).toBe('fix the bug')
    expect(r.sessionDeltaUsd).toBeUndefined()
    expect(r.toolCount).toBe(1)
    expect(toRecap(newTally('t', 0, 'x', 2), 10, 5, 'answer', 1).sessionDeltaUsd).toBe(0)
  })

  test('the file list keeps at least one name; the summary prompt keeps both ends of a long answer', async () => {
    expect(fileList(['a-very-long-file-name.ts', 'b.ts'], 4)).toBe('a-very-long-file-name.ts +1')
    expect(fileList(['a.ts', 'b.ts'], 40)).toBe('a.ts, b.ts')
    const long = `${'a'.repeat(4000)}${'b'.repeat(4000)}`
    const p = summaryPrompt(long)
    expect(p).toContain(`${'a'.repeat(3000)}\n…\n${'b'.repeat(3000)}`)
    expect(p).not.toContain('a'.repeat(3001))
  })
})

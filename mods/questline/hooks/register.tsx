import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Quest, QuestSnap } from '../types'
import type { BarProps } from './bar.tsx'
import { coarseSpan, createTask, fromTodos, isShown, progress, updateTask } from './quests.ts'
import type { Todo } from './quests.ts'
import { questSvg } from './svg.ts'

const snapAtom = atom({ plugin: 'questline', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'questline', key: 'isHidden' } as const, false)

// The quest list: TodoWrite rows and TaskCreate/TaskUpdate tasks of the main
// loop. Module variables start over on a reload; session.start restores them
// from the last snapshot, which the session keeps.
let todos: Quest[] = []
let tasks: Quest[] = []
let allDoneAt: number | null = null
let publishedKey = ''

const all = (): Quest[] => [...tasks, ...todos]

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const items = all()
  const { done, total, active } = progress(items)
  if (total > 0 && done === total) allDoneAt ??= now
  else allDoneAt = null
  const isVisible = isShown(items, allDoneAt, now)
  // The desktop caption shows a coarse elapsed time: publish when it changes.
  const key = JSON.stringify({ items, isVisible, since: active?.since !== undefined ? coarseSpan(now - active.since) : '' })
  if (key === publishedKey) return
  publishedKey = key
  const snap: QuestSnap = { items, done, total, allDoneAt, isVisible, now }
  await update($, snapAtom, () => snap)
}

async function restore($: EngineInterface): Promise<void> {
  const snap = await read($, snapAtom)
  if (!snap) return
  tasks = snap.items.filter(q => q.id.startsWith('task:'))
  todos = snap.items.filter(q => q.id.startsWith('todo:'))
  allDoneAt = snap.allDoneAt
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session only.
  }
}

async function loadHidden($: EngineInterface): Promise<void> {
  try {
    const v = await $.store.get('isHidden')
    if (typeof v === 'boolean') await update($, hiddenAtom, () => v)
  } catch {
    // Nothing stored.
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    todos = []
    tasks = []
    allDoneAt = null
    publishedKey = ''
    await restore($)
    await $.command.register({ name: 'questline', description: 'KOZMOS: show or hide the Questline task bar above the prompt', immediate: true })
    await loadHidden($)
    $.clock.every(1000, () => void publish($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'questline' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Questline hidden. /questline brings it back.' : 'Questline shown: it appears while the session has tasks.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.isError === true || ran.deny !== undefined) return ran
    const now = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'TodoWrite' && Array.isArray(input.todos)) {
      todos = fromTodos(todos, input.todos as Todo[], now)
    } else if (e.tool === 'TaskCreate') {
      const created = (ran.result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
      const id = created?.id
      if (typeof id === 'string' || typeof id === 'number') tasks = createTask(tasks, String(id), str(created?.subject) ?? str(input.subject) ?? `Task #${id}`, str(input.activeForm))
    } else if (e.tool === 'TaskUpdate' && (typeof input.taskId === 'string' || typeof input.taskId === 'number')) {
      tasks = updateTask(tasks, { taskId: String(input.taskId), status: str(input.status), subject: str(input.subject), activeForm: str(input.activeForm) }, now)
    } else return ran
    await publish($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || !snap.isVisible) return drawn
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)

    if (e.surface === 'terminal') {
      const { Box, Button, Client } = $.ui.resolve(e)
      const { active } = progress(snap.items)
      const now = await $.clock.now()
      const props: BarProps = {
        marks: snap.items.map(q => (q.status === 'completed' ? 'd' : q.status === 'in_progress' ? 'a' : 'p')).join(''),
        done: snap.done,
        total: snap.total,
        activeText: active?.active ?? '',
        activeMs: active?.since !== undefined ? Math.max(0, now - active.since) : -1,
        allDone: snap.total > 0 && snap.done === snap.total,
      }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="questline" flexDirection="row">
            <Client key="questline-bar" module="./bar.tsx" width={cols} height={1} props={props} />
            <Button key="questline-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    if ('Svg' in ui) {
      const { Box, Button, Svg } = ui
      const pic = questSvg(snap, cols * 8 - 8)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="questline" flexDirection="row">
            <Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
            <Button key="questline-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }
    return drawn
  })
}

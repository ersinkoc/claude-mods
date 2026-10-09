import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FallTool, GlyphSnap } from '../types'
import { pxOf, toolColor, toolDetail } from './lib/kz.ts'
import { rainAlt, rainSvg } from './rain.ts'

const snapAtom = atom({ plugin: 'glyphfall', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'glyphfall', key: 'isHidden' } as const, false)

const KEEP = 12

// Live collector; the band draws from the snapshot published to $.state.
let tools: FallTool[] = []
let seq = 0
let lastKey = ''

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; the session still honours it.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const snap: GlyphSnap = { now, tools: tools.map(t => ({ ...t })) }
  // Words in flight need the desktop redrawn now and then; a quiet band does not.
  const isFalling = tools.some(t => t.end === null || now - t.end < 4000)
  const key = JSON.stringify({ ...snap, now: isFalling ? now : 0 })
  if (key === lastKey) return
  lastKey = key
  await update($, snapAtom, () => snap)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    tools = []
    seq = 0
    lastKey = ''
    await $.command.register({ name: 'glyphfall', description: 'KOZMOS: show or hide the Glyphfall tool rain above the prompt', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // Fresh store.
    }
    $.clock.every(1000, () => void publish($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'glyphfall' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Glyphfall hidden.' : 'Glyphfall shown.' }
  })

  // Every tool call, the main loop's and the subagents', drops a word.
  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const rec: FallTool = {
      id: e.tool_use_id || `kz-${++seq}`,
      at: await $.clock.now(),
      end: null,
      name,
      detail: toolDetail(name, e),
      color: toolColor(name),
      isError: false,
    }
    tools = [...tools, rec].slice(-KEEP)
    void publish($).catch(() => undefined)
    const ran = await next(e)
    rec.end = await $.clock.now()
    rec.isError = ran.isError === true || ran.deny !== undefined
    void publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || !e.props.isWorking || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || snap.tools.length === 0) return drawn

    const { Box, Button } = $.ui.resolve(e)
    const hide = <Button key="glyphfall-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />

    // Every surface but the terminal draws SVG; the terminal animates a Client.
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      const W = pxOf(e.props.bodyColumns)
      const H = e.props.maxRows >= 10 ? 96 : 76
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row">
            <Svg source={rainSvg(snap.tools, snap.now, W, H)} alt={rainAlt(snap.tools)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    const { Client } = $.ui.resolve(e)
    const cols = Math.max(24, e.props.bodyColumns || 80)
    const rows = e.props.maxRows >= 10 ? 4 : 3
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client key="glyphfall" module="./scene.tsx" width={cols - 2} height={rows} props={{ tools: snap.tools, now: snap.now, width: cols - 2, rows }} />
          {hide}
        </Box>
      </Box>
    )
  })
}

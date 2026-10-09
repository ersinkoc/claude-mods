import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { TideFile } from '../types'
import { pxOf } from './lib/kz.ts'
import { EDIT_TOOLS, editDelta, editPath, mergeEdit, tideAlt, tideSvg, totalsLine } from './tide.ts'

const snapAtom = atom({ plugin: 'tidewater', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'tidewater', key: 'isHidden' } as const, false)

// The tide since the last prompt; the band draws the snapshot in $.state.
let files: TideFile[] = []

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('hidden', isHidden)
  } catch {
    // Not persisted; this session still honours it.
  }
}

async function publish($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, snapAtom, () => ({ files: files.map(f => ({ ...f })), now }))
}

async function recede($: EngineInterface): Promise<void> {
  if (!files.length) return
  files = []
  await update($, snapAtom, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    files = []
    await $.command.register({ name: 'tidewater', description: 'KOZMOS: show or hide the Tidewater band (this turn\'s diff as tides)', immediate: true })
    try {
      const stored = await $.store.get('hidden')
      if (typeof stored === 'boolean') await update($, hiddenAtom, () => stored)
    } catch {
      // A fresh store.
    }
    return started
  })

  on('command.run', { command: 'tidewater' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    const snap = await read($, snapAtom)
    const now = snap?.files.length ? ` This turn: ${totalsLine(snap.files)}.` : ''
    return { text: (isHidden ? 'Tidewater hidden.' : 'Tidewater shown.') + now }
  })

  // A new prompt typed while idle starts a new tide; one delivered into a
  // running turn (a queued message) keeps the current one.
  on('prompt.submit', async ($, e, next) => {
    // Should recede fail, the .catch handler passes the prompt on all the same.
    if (e.turnId === undefined) await recede($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (!EDIT_TOOLS.includes(tool) || ran.deny !== undefined || ran.isError === true) return ran
    const path = editPath(e)
    if (!path) return ran
    const result = ran.result as { staged?: boolean } | undefined
    if (result?.staged === true) return ran
    const d = editDelta(tool, e, ran.result)
    files = mergeEdit(files, path, d, await $.clock.now())
    await publish($).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap || snap.files.length === 0) return drawn

    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const hide = <Button key="tidewater-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
    const rows = e.props.maxRows >= 10 ? 3 : 2

    if ('Svg' in ui && e.surface !== 'terminal') {
      const { Svg } = ui
      const W = pxOf(e.props.bodyColumns) - 28
      const H = rows >= 3 ? 84 : 68
      return (
        <Box flexDirection="column">
          {drawn}
          <Box flexDirection="row" alignItems="flex-start">
            <Svg source={tideSvg(snap.files, W, H, snap.now)} alt={tideAlt(snap.files)} width={W} height={H} />
            {hide}
          </Box>
        </Box>
      )
    }

    // Past the Svg surfaces only the terminal is left, and it draws Client.
    const { Client } = ui as Elements['terminal']
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)
    const newest = snap.files[snap.files.length - 1]!.path
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Client key="tidewater" module="./waves.tsx" width={cols} height={rows} props={{ cols, rows, files: snap.files, newest }} />
          {hide}
        </Box>
      </Box>
    )
  })
}

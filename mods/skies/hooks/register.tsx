import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SkiesSnap, Weather } from '../types'
import { climate, forecast, localHour, nextRainbow, parseOffset, WINDOW } from './climate.ts'
import type { Bow } from './climate.ts'
import type { SceneProps } from './scene.tsx'
import { skySvg, TONE } from './svg.ts'

const snapAtom = atom({ plugin: 'skies', key: 'snap' } as const, null)
const hiddenAtom = atom({ plugin: 'skies', key: 'isHidden' } as const, false)

const TICK_MS = 2000

// The climate's inputs. Module variables start over on a reload.
let results: boolean[] = []
let lastSuccessAt: number | undefined
let ctx: number | null = null
let fiveHour: number | null = null
let isWorking = false
let hasActivity = false
let tzOffset: number | undefined
let weather: Weather | undefined
let base: Weather | undefined
let bow: Bow = { until: 0, stormAt: undefined }
let since = 0
let publishedKey = ''

/** Minutes east of UTC, once per session: the hooks' own clock may not know the zone. */
async function detectOffset($: EngineInterface): Promise<void> {
  try {
    const isWindows = /windows/i.test((await $.env.get('OS')) ?? '')
    const argv = isWindows
      ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', '[int][TimeZoneInfo]::Local.GetUtcOffset([DateTime]::UtcNow).TotalMinutes']
      : ['date', '+%z']
    const r = await $.process.run(argv, { timeoutMs: 8000 })
    if (r.exitCode === 0) tzOffset = parseOffset(r.stdout)
  } catch {
    // Fall back to the environment's own idea of the zone.
  }
  tzOffset ??= -new Date().getTimezoneOffset()
}

async function readUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    ctx = u.context.percent ?? null
    fiveHour = u.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? null
  } catch {
    // Keep the last reading.
  }
}

async function publish($: EngineInterface): Promise<void> {
  if (!hasActivity) return
  const now = await $.clock.now()
  const staleMin = lastSuccessAt === undefined ? null : Math.floor((now - lastSuccessAt) / 60_000)
  const sky = climate({ results, ctx, fiveHour, staleMin, hour: localHour(now, tzOffset ?? 0), isWorking })
  bow = nextRainbow(base, sky, now, bow)
  base = sky
  const next: Weather = now < bow.until ? 'rainbow' : sky
  if (next !== weather) since = now
  weather = next
  const snap: SkiesSnap = {
    weather: next,
    failed: results.filter(Boolean).length,
    total: results.length,
    ctx: ctx === null ? null : Math.round(ctx),
    fiveHour: fiveHour === null ? null : Math.round(fiveHour),
    staleMin,
    isWorking,
    since,
  }
  const key = JSON.stringify(snap)
  if (key === publishedKey) return
  publishedKey = key
  await update($, snapAtom, () => snap)
}

async function tick($: EngineInterface): Promise<void> {
  if (!hasActivity) return
  await readUsage($)
  await publish($)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    results = []
    lastSuccessAt = undefined
    ctx = fiveHour = null
    isWorking = false
    hasActivity = false
    weather = undefined
    base = undefined
    bow = { until: 0, stormAt: undefined }
    publishedKey = ''
    await $.command.register({ name: 'skies', description: 'KOZMOS: show or hide the Skies session weather above the prompt', immediate: true })
    await loadHidden($)
    void detectOffset($).catch(() => undefined)
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'skies' }, async $ => {
    const isHidden = !(await read($, hiddenAtom))
    await setHidden($, isHidden)
    return { text: isHidden ? 'Skies hidden. /skies brings it back.' : 'Skies shown: the session weather appears once work starts.' }
  })

  on('turn.start', async ($, e, next) => {
    isWorking = true
    hasActivity = true
    await readUsage($)
    await publish($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isWorking = false
      await publish($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.isError === true || ran.deny !== undefined
    results = [...results, failed].slice(-WINDOW)
    if (!failed) lastSuccessAt = await $.clock.now()
    hasActivity = true
    await publish($)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const snap = await read($, snapAtom)
    if (!snap) return drawn
    const cols = Math.max(20, (e.props.bodyColumns || 80) - 3)

    if (e.surface === 'terminal') {
      const { Box, Button, Client } = $.ui.resolve(e)
      const props: SceneProps = { weather: snap.weather, forecast: forecast(snap), tone: TONE[snap.weather] }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="skies" flexDirection="row">
            <Client key="skies-scene" module="./scene.tsx" width={cols} height={e.props.maxRows >= 8 ? 4 : 1} props={props} />
            <Button key="skies-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    const ui = $.ui.resolve(e)
    if ('Svg' in ui) {
      const { Box, Button, Svg } = ui
      const pic = skySvg(snap, cols * 8 - 8)
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="skies" flexDirection="row">
            <Svg source={pic.source} alt={pic.alt} width={pic.width} height={pic.height} />
            <Button key="skies-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }
    return drawn
  })
}

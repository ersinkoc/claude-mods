import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderSurface } from 'claude-code'

import type { ThriftLimit, ThriftMode, ThriftSnap, ThriftTally } from '../types'
import type { CoinProps } from './coin.tsx'
import { KZ, costOf, fmtPct, fmtSpan, fmtUsd, heat, limitLabel, pxOf, svg, svgBar, svgText } from './lib/kz.ts'

/** What the model reads beside each prompt while thrift is on (under 50 words). */
export const THRIFT_NOTE =
  'Thrift mode is on: usage limits are tight. Be economical: prefer targeted reads (specific files, line ranges) over broad searches, avoid subagents unless clearly needed, do not re-read what you already have, and keep answers concise.'

const blank = (mode: ThriftMode, autoAt: number): ThriftSnap => ({
  mode,
  isOn: mode === 'on',
  autoAt,
  top: null,
  thrift: { turns: 0, cost: 0 },
  normal: { turns: 0, cost: 0 },
})

const snapAtom = atom({ plugin: 'thrift', key: 'snap' } as const, blank('off', 90))
const hiddenAtom = atom({ plugin: 'thrift', key: 'isHidden' } as const, false)

// ---------------------------------------------------------------------------
// The live state. Module variables start over on a reload; session.start fills them.

let live: ThriftSnap = blank('off', 90)
let limits: ThriftLimit[] = []
let turn: { id: string; isThrift: boolean; cost: number } | null = null
let publishedKey = ''

const isMode = (v: unknown): v is ThriftMode => v === 'on' || v === 'off' || v === 'auto'

/** The fullest 5h / 7d window that has not reset yet. */
export function topLimit(all: readonly ThriftLimit[], now: number): ThriftLimit | null {
  let top: ThriftLimit | null = null
  for (const l of all) {
    if (l.kind !== 'five_hour' && l.kind !== 'seven_day') continue
    const resets = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    if (Number.isFinite(resets) && resets <= now) continue
    if (!top || l.percentUsed > top.percentUsed) top = l
  }
  return top
}

async function publish($: EngineInterface): Promise<void> {
  const key = JSON.stringify(live)
  if (key === publishedKey) return
  publishedKey = key
  const copy: ThriftSnap = { ...live, top: live.top ? { ...live.top } : null, thrift: { ...live.thrift }, normal: { ...live.normal } }
  await update($, snapAtom, () => copy)
}

/** Works out whether thrift is on, and says so when auto flips it. */
async function evaluate($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  live.top = topLimit(limits, now)
  const wasOn = live.isOn
  if (live.mode === 'on') live.isOn = true
  else if (live.mode === 'off') live.isOn = false
  else live.isOn = live.top !== null && live.top.percentUsed >= live.autoAt
  if (live.mode === 'auto' && wasOn !== live.isOn) {
    $.ui.toast(live.isOn && live.top
      ? `🪙 thrift on (auto): ${limitLabel(live.top.kind)} at ${fmtPct(live.top.percentUsed)}`
      : '🪙 thrift off (auto): the window reset', { timeoutMs: 6000 })
  }
  await publish($)
}

async function readLimits($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    limits = u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
  } catch {
    // Keep the last reading.
  }
  await evaluate($)
}

async function setMode($: EngineInterface, mode: ThriftMode): Promise<void> {
  live.mode = mode
  try {
    await $.store.set('mode', mode)
  } catch {
    // For this session at least.
  }
  await evaluate($)
}

async function setHidden($: EngineInterface, isHidden: boolean): Promise<void> {
  await update($, hiddenAtom, () => isHidden)
  try {
    await $.store.set('isHidden', isHidden)
  } catch {
    // Hidden for this session at least.
  }
}

async function loadStored($: EngineInterface): Promise<void> {
  try {
    const m = await $.store.get('mode')
    if (isMode(m)) live.mode = m
    const h = await $.store.get('isHidden')
    if (typeof h === 'boolean') await update($, hiddenAtom, () => h)
  } catch {
    // Nothing stored yet.
  }
}

async function endTurn($: EngineInterface, done: { isThrift: boolean; cost: number }): Promise<void> {
  const tally: ThriftTally = done.isThrift ? live.thrift : live.normal
  tally.turns++
  tally.cost += done.cost
  turn = null
  await readLimits($)
}

const avg = (t: ThriftTally): number | undefined => (t.turns ? t.cost / t.turns : undefined)

/** `thrift turns cost 61% less on average`, or undefined until both kinds ran. */
export function comparison(s: Pick<ThriftSnap, 'thrift' | 'normal'>): string | undefined {
  const a = avg(s.thrift)
  const b = avg(s.normal)
  if (a === undefined || b === undefined || b <= 0) return undefined
  const d = Math.round((1 - a / b) * 100)
  return d >= 0 ? `thrift turns cost ${d}% less on average` : `thrift turns cost ${-d}% more on average`
}

async function report($: EngineInterface): Promise<string> {
  await readLimits($)
  const s = live
  const now = await $.clock.now()
  const top = s.top
  const reset = top?.resetsAt ? Date.parse(top.resetsAt) - now : NaN
  const state = s.isOn ? 'ON' : 'off'
  const avgOf = (t: ThriftTally) => {
    const a = avg(t)
    return a !== undefined ? fmtUsd(a) : '—'
  }
  const lines = [
    `🪙 KOZMOS thrift · mode ${s.mode}${s.mode === 'auto' ? ` (on at ${s.autoAt}%)` : ''} · now ${state}${top ? ` · ${limitLabel(top.kind)} ${fmtPct(top.percentUsed)}${Number.isFinite(reset) ? `, resets in ${fmtSpan(reset)}` : ''}` : ''}`,
    '',
    'This session:',
    `  thrift turns  ${String(s.thrift.turns).padStart(3)} · avg ${avgOf(s.thrift)}`,
    `  normal turns  ${String(s.normal.turns).padStart(3)} · avg ${avgOf(s.normal)}`,
  ]
  const cmp = comparison(s)
  lines.push(cmp ? `  → ${cmp}` : '  (the comparison appears once both kinds of turn have run)')
  lines.push('', '/thrift on · off · auto · hide · show')
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  // userConfig gives autoAt a number (90 unless set); 0 reads as the default too.
  const autoAt = Math.max(1, Math.min(100, Number(options.autoAt) || 90))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank('off', autoAt)
    limits = []
    turn = null
    publishedKey = ''
    await $.command.register({ name: 'thrift', description: 'KOZMOS: frugal mode — /thrift on|off|auto; /thrift alone compares thrift and normal turn costs', argumentHint: '[on|off|auto|hide|show]', immediate: true })
    await loadStored($)
    await readLimits($)
    // A window resets on its own clock: look again every minute.
    $.clock.every(60_000, () => void evaluate($).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'thrift' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (isMode(arg)) {
      await setMode($, arg)
      const why = arg === 'auto' ? ` It turns on when the 5h or 7d limit passes ${autoAt}%${live.isOn ? ' — and it is on now' : ''}.` : ''
      return { text: `🪙 thrift ${arg}.${why}` }
    }
    if (arg === 'hide' || arg === 'show') {
      await setHidden($, arg === 'hide')
      return { text: arg === 'hide' ? 'thrift band hidden (thrift itself keeps its mode).' : 'thrift band shown.' }
    }
    return { text: await report($) }
  })

  // Observer plus rewrite: the note rides beside the prompt, never in it.
  on('prompt.submit', async ($, e, next) => {
    if (!live.isOn) return next(e)
    return next({ ...e, context: [...(e.context ?? []), THRIFT_NOTE] })
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    if (e.changed.includes('rateLimits')) {
      limits = e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
      await evaluate($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    turn = { id: e.turnId, isThrift: live.isOn, cost: 0 }
    return next(e)
  })

  // Every model request while a main turn runs, its subagents' included.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (turn && r.usage) turn.cost += costOf(r.usage.model || e.model, r.usage)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && turn && turn.id === e.turnId) await endTurn($, turn)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.hasSurvey || (await read($, hiddenAtom))) return drawn
    const s = await read($, snapAtom)
    if (!s.isOn) return drawn
    const cols = Math.max(30, e.props.bodyColumns || 80)
    const lim = s.top ? `${limitLabel(s.top.kind)} ${fmtPct(s.top.percentUsed)}` : 'no limit reading'
    const cmp = comparison(s)

    if (e.surface === 'terminal') {
      const { Box, Button, Client, Text } = $.ui.resolve(e)
      const coin: CoinProps = { isOn: true }
      return (
        <Box flexDirection="column">
          {drawn}
          <Box key="thrift" flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              <Client key="thrift-coin" module="./coin.tsx" width={2} height={1} props={coin} />
              <Text wrap="truncate-end">
                <Text bold color={KZ.yellow}>thrift on</Text>
                <Text dimColor> · </Text>
                <Text color={s.top ? heat(s.top.percentUsed / 100) : KZ.mist}>{lim}</Text>
                <Text dimColor> · saving mode{s.mode === 'auto' ? ' (auto)' : ''}</Text>
                {cmp && cols > 70 ? <Text color={KZ.green}> · {cmp}</Text> : ''}
              </Text>
            </Box>
            <Button key="thrift-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
          </Box>
        </Box>
      )
    }

    // Every surface but the terminal draws Svg.
    const { Box, Button, Svg } = $.ui.resolve(e) as Elements[Exclude<RenderSurface, 'terminal'>]
    const W = Math.max(240, pxOf(cols) - 40)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box key="thrift" flexDirection="row" alignItems="center">
          <Svg source={bandSvg(W, s, lim, cmp)} alt={`thrift on · ${lim} · saving mode${cmp ? ` · ${cmp}` : ''}`} width={W} height={44} />
          <Button key="thrift-hide" label="✕" plain dimColor role="dismiss" onPress={() => void setHidden($, true)} />
        </Box>
      </Box>
    )
  })
}

/** The desktop band: a coin flipping on its edge, the limit gauge, the saving. */
function bandSvg(W: number, s: ThriftSnap, lim: string, cmp: string | undefined): string {
  const gold = '#facc15'
  const deep = '#d97706'
  const gaugeW = Math.min(180, Math.max(90, W * 0.22))
  const gx = W - gaugeW - 14
  const css = `.flip{transform-box:fill-box;transform-origin:center;animation:tflip 1.8s ease-in-out infinite}
@keyframes tflip{0%,100%{transform:scaleX(1)}25%{transform:scaleX(.08)}50%{transform:scaleX(-1)}75%{transform:scaleX(.08)}}
.shine{animation:tshine 1.8s ease-in-out infinite}@keyframes tshine{0%,100%{opacity:.9}25%,75%{opacity:.2}50%{opacity:.6}}
.drop{animation:tdrop 2.4s ease-in infinite}@keyframes tdrop{0%{transform:translateY(-8px);opacity:0}30%{opacity:1}100%{transform:translateY(10px);opacity:0}}`
  const ratio = s.top ? s.top.percentUsed / 100 : 0
  const body = `<rect class="p" x="0" y="0" width="${W}" height="44" rx="12"/>
<rect x="0" y="0" width="4" height="44" rx="2" fill="${gold}"/>
<g transform="translate(26 22)"><g class="flip"><circle r="12" fill="${gold}" stroke="${deep}" stroke-width="2"/><circle r="8.2" fill="none" stroke="${deep}" stroke-width="1.2" opacity=".7"/>
<text x="0" y="4.5" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-size="12" font-weight="800" fill="${deep}">¢</text>
<path class="shine" d="M-7 -6a10 10 0 0 1 6-4" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></g></g>
<circle class="drop" cx="46" cy="14" r="2.2" fill="${gold}" opacity=".8"/>
${svgText(54, 19, 'thrift on', { size: 13.5, weight: 750, fill: deep })}
${svgText(54 + 68, 19, `· ${lim} · saving mode${s.mode === 'auto' ? ' (auto)' : ''}`, { cls: 't', size: 12.5, weight: 600 })}
${svgText(54, 36, cmp ?? `${s.thrift.turns} thrift turn${s.thrift.turns === 1 ? '' : 's'} so far · targeted reads, no broad searches, concise answers`, { size: 10.5, ...(cmp ? { fill: KZ.green } : { cls: 'm' }) })}
${s.top ? svgText(gx, 16, `${limitLabel(s.top.kind)} window`, { cls: 's', size: 10, weight: 600 }) : ''}
${s.top ? svgText(gx + gaugeW, 16, fmtPct(s.top.percentUsed), { size: 11, weight: 700, anchor: 'end' }) : ''}
${s.top ? svgBar(gx, 22, gaugeW, 7, ratio, heat(ratio)) : ''}
${s.top ? `<line x1="${gx + gaugeW * (s.autoAt / 100)}" x2="${gx + gaugeW * (s.autoAt / 100)}" y1="19" y2="32" stroke="${KZ.red}" stroke-width="1.4" stroke-dasharray="2 2"/>` : ''}`
  return svg(W, 44, body, css)
}

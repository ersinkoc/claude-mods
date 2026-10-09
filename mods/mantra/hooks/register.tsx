import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MantraLive, MantraTool } from '../types'
import { clip, fmtClock, hash, toolDetail, toolGlyph, toolName } from './lib/kz.ts'

// Word packs: every word written for KOZMOS. The spinner keeps the engine's
// ellipsis and timer; only the word and the tail after it change.
const PACKS: Readonly<Record<string, readonly string[]>> = {
  cosmic: [
    'Warping', 'Orbiting', 'Stargazing', 'Drifting', 'Slingshotting', 'Terraforming', 'Comet-chasing',
    'Moonwalking', 'Docking', 'Hyperjumping', 'Gravitating', 'Eclipsing', 'Pulsating', 'Spacewalking',
    'Star-charting', 'Accreting', 'Ionizing', 'Coalescing', 'Redshifting', 'Transiting', 'Quasar-hunting',
    'Nebula-weaving', 'Starhopping', 'Igniting', 'Free-falling', 'Aligning planets', 'Beaming down',
  ],
  zen: [
    'Breathing', 'Contemplating', 'Raking sand', 'Steeping', 'Pondering', 'Settling', 'Centering',
    'Listening', 'Unfolding', 'Balancing', 'Sitting still', 'Noticing', 'Letting go', 'Arranging stones',
    'Watering', 'Pruning', 'Flowing', 'Softening', 'Grounding', 'Releasing', 'Pouring tea', 'Folding paper',
    'Observing', 'Stilling', 'Rippling', 'Sweeping the path', 'Lighting incense',
  ],
  pirate: [
    'Plundering', 'Hoisting sails', 'Swashbuckling', 'Charting courses', 'Parleying', 'Keelhauling',
    'Marooning', 'Boarding', 'Splicing the mainbrace', 'Swabbing decks', 'Dropping anchor', 'Sailing',
    'Treasure-hunting', 'Spyglassing', 'Navigating', 'Mutinying', 'Firing cannons', 'Looting', 'Tacking',
    'Yo-ho-hoing', 'Pumping bilge', 'Belaying', 'Climbing rigging', 'Pillaging', 'Reading the map',
    'Burying gold', 'Raising the flag',
  ],
  turkish: [
    'Düşünüyor', 'Kurcalıyor', 'Demleniyor', 'Harmanlıyor', 'Yoğuruyor', 'Kurguluyor', 'Didikliyor',
    'Eşeliyor', 'Örüyor', 'Süzüyor', 'Tartıyor', 'Ayıklıyor', 'Pişiriyor', 'Mayalanıyor', 'Kavuruyor',
    'Ölçüp biçiyor', 'Toparlıyor', 'Çözümlüyor', 'Tasarlıyor', 'Karıştırıyor', 'Damıtıyor', 'Tarıyor',
    'Dokuyor', 'Şekillendiriyor', 'Hesaplıyor', 'Ayarlıyor', 'Cilalıyor', 'Kafa yoruyor',
  ],
  hacker: [
    'Compiling', 'Grepping', 'Piping', 'Forking', 'Hashing', 'Fuzzing', 'Patching', 'Bootstrapping',
    'Spelunking', 'Decrypting', 'Rebasing', 'Bit-twiddling', 'Tunneling', 'Sniffing packets', 'Overclocking',
    'Refactoring', 'Linking', 'Disassembling', 'Recursing', 'Caching', 'Daemonizing', 'Hot-swapping',
    'Defragging', 'Yak-shaving', 'Multiplexing', 'Grokking', 'Pinging',
  ],
}
const PACK_NAMES = Object.keys(PACKS)
const ROTATE_MS = 4000

const blank = (): MantraLive => ({ tools: {}, agents: [], isWorking: false, turnSeed: 0, now: 0 })
const liveAtom = atom({ plugin: 'mantra', key: 'live' } as const, blank())
const packAtom = atom({ plugin: 'mantra', key: 'pack' } as const, '')
const onAtom = atom({ plugin: 'mantra', key: 'isOn' } as const, true)

let live: MantraLive = blank()
let lastPublished = ''

async function publish($: EngineInterface): Promise<void> {
  live.now = await $.clock.now()
  const busy = live.isWorking || Object.keys(live.tools).length > 0
  // While nothing runs the clock does not matter: an idle line never redraws.
  const key = JSON.stringify({ ...live, now: busy ? Math.floor(live.now / 1000) : 0 })
  if (key === lastPublished) return
  lastPublished = key
  const snap: MantraLive = { ...live, tools: { ...live.tools }, agents: [...live.agents] }
  await update($, liveAtom, () => snap)
}

/** What the tail calls a tool: the command for a shell, the file or pattern otherwise. */
function toolLabel(tool: string, input: unknown): string {
  const e = (input ?? {}) as Record<string, unknown>
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof e.command === 'string') return clip(e.command.split('\n')[0] ?? '', 28)
  return clip(toolDetail(tool, input) || toolName(tool), 28)
}

/** The pack's word for this spinner now: deterministic per turn, instance and 4 s slot. */
function wordAt(words: readonly string[], requestId: string, seed: number, now: number): string {
  const start = hash(`${requestId}:${seed}`) % words.length
  return words[(start + Math.floor(now / ROTATE_MS)) % words.length] ?? words[0] ?? 'Working'
}

async function setPack($: EngineInterface, pack: string): Promise<void> {
  await update($, packAtom, () => pack)
  await $.store.set('pack', pack)
}

async function setOn($: EngineInterface, isOn: boolean): Promise<void> {
  await update($, onAtom, () => isOn)
  await $.store.set('isOn', isOn)
}

export const register: Register = (on, options) => {
  const defaultPack = typeof options.pack === 'string' && PACKS[options.pack] ? options.pack : 'cosmic'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    live = blank()
    lastPublished = ''
    await $.command.register({
      name: 'mantra',
      description: `KOZMOS: theme the spinner (/mantra ${PACK_NAMES.join('|')}|on|off)`,
      argumentHint: `[${PACK_NAMES.join('|')}|on|off]`,
      immediate: true,
    })
    try {
      const pack = await $.store.get('pack')
      if (typeof pack === 'string' && PACKS[pack]) await update($, packAtom, () => pack)
      const isOn = await $.store.get('isOn')
      await update($, onAtom, () => isOn !== false)
    } catch {
      // Defaults stand.
    }
    $.clock.every(1000, () => void (live.isWorking || Object.keys(live.tools).length ? publish($) : Promise.resolve()).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'mantra' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await setOn($, arg === 'on')
      return { text: arg === 'on' ? 'Mantra on.' : 'Mantra off: the spinner is the engine’s again.' }
    }
    if (PACKS[arg]) {
      await setPack($, arg)
      await setOn($, true)
      const sample = (PACKS[arg] ?? []).slice(0, 3).join(', ')
      return { text: `Mantra pack: ${arg} (${sample}, …)` }
    }
    if (arg) return { text: `Unknown pack "${arg}". Packs: ${PACK_NAMES.join(', ')}; or on, off.` }
    const isOn = !(await read($, onAtom))
    await setOn($, isOn)
    const pack = (await read($, packAtom)) || defaultPack
    return { text: isOn ? `Mantra on (${pack}). Packs: ${PACK_NAMES.join(', ')}.` : 'Mantra off.' }
  })

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    live.turnSeed = hash(e.turnId)
    live.tools = {}
    void publish($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined && String(e.effort) !== live.effort) {
      live.effort = String(e.effort)
      void publish($).catch(() => undefined)
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      live.isWorking = false
      live.tools = {}
      void publish($).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? 'main'
    const tool = String(e.tool)
    const mine: MantraTool = { name: tool, label: toolLabel(tool, e), startedAt: await $.clock.now() }
    live.tools[loop] = mine
    if (e.agentId !== undefined && !live.agents.includes(e.agentId)) live.agents = [...live.agents, e.agentId].slice(-50)
    void publish($).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      if (live.tools[loop] === mine) delete live.tools[loop]
      void publish($).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!(await read($, onAtom))) return next(e)
    const words = PACKS[(await read($, packAtom)) || defaultPack] ?? PACKS.cosmic ?? []
    const state = await read($, liveAtom)
    if (!words.length) return next(e)

    const isOwnLoop = state.agents.includes(e.requestId)
    const tool = state.tools[e.requestId] ?? (isOwnLoop ? undefined : state.tools.main)
    const now = Math.max(state.now, tool?.startedAt ?? 0)
    const tail: string[] = []
    if (tool) tail.push(`${toolGlyph(tool.name)} ${tool.label} ${fmtClock(now - tool.startedAt)}`)
    else if (e.props.mode === 'thinking' && state.effort) tail.push(`∴ ${state.effort}`)
    const suffix = tail.length ? `${e.props.suffix} · ${tail.join(' · ')}` : e.props.suffix

    // The desktop's word says what the step is doing ("Creating notes.md"):
    // keep it, and theme only the generic "Working".
    const keepsWord = e.surface !== 'terminal' && e.props.word !== 'Working'
    const word = keepsWord ? e.props.word : wordAt(words, e.requestId, state.turnSeed, state.now)
    if (word === e.props.word && suffix === e.props.suffix) return next(e)
    return next({ ...e, props: { ...e.props, word, suffix } })
  })
}

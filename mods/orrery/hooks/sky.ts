// Orrery's pure drawing: orbits, planets and sun as a cell frame for the
// terminal and as one SVG with CSS orbits for the desktop. No `$` here.
import { KZ, clip, fitText, fmtClock, mix, noise, svg, svgText } from './lib/kz.ts'

export type Agent = {
  id: string
  desc: string
  type: string
  model: string
  order: number
  status: 'run' | 'done' | 'fail'
  start: number
  end: number | null
  tps: number
  tokens: number
  angle: number
  omega: number
}
export type Seg = { s: string; c?: string; b?: boolean; d?: boolean }

const PALETTE = [KZ.violet, KZ.cyan, KZ.magenta, KZ.lime, KZ.amber, KZ.blue, KZ.teal, KZ.yellow]
export const DIM = '#5b6470'
const TAU = Math.PI * 2

export function agentColor(order: number): string {
  return PALETTE[((order % PALETTE.length) + PALETTE.length) % PALETTE.length]!
}

/** A glyph per agent type: explorers ◍, planners ◆, reviewers ◈, the rest ●. */
export function planetGlyph(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('explore') || t.includes('search')) return '◍'
  if (t.includes('plan') || t.includes('architect')) return '◆'
  if (t.includes('review') || t.includes('audit')) return '◈'
  return '●'
}

/** Angular speed (rad/s) from output tokens per second: a crawl when silent, a whirl when streaming. */
export function omegaOf(tps: number): number {
  return 0.22 + 2.4 * (1 - Math.exp(-Math.max(0, tps) / 55))
}

/** Where an agent stands at `t`: its angle extrapolated from the snapshot. */
export function angleAt(a: Agent, snapNow: number, t: number): number {
  return a.status === 'run' ? a.angle + (a.omega * (t - snapNow)) / 1000 : a.angle
}

/** Which agents the legend lists: running first (by spawn), then the latest to finish. */
export function legendAgents(agents: readonly Agent[], max = 4): Agent[] {
  const run = agents.filter(a => a.status === 'run').sort((a, b) => a.order - b.order)
  const rest = agents.filter(a => a.status !== 'run').sort((a, b) => (b.end ?? 0) - (a.end ?? 0))
  return [...run, ...rest].slice(0, max)
}

export function elapsedOf(a: Agent, now: number): number {
  return (a.end ?? now) - a.start
}

const LEFT = [0x01, 0x02, 0x04, 0x40]
const RIGHT = [0x08, 0x10, 0x20, 0x80]

type Cell = { ch: string; c: string; b?: boolean }

/** The orbit field: `w` × `h` cells, the sun at the center, newest frame at `t`. */
export function fieldFrame(agents: readonly Agent[], snapNow: number, t: number, w: number, h: number, sunTps: number, isWorking: boolean): Seg[][] {
  const W = Math.max(9, Math.floor(w))
  const H = Math.max(3, Math.floor(h))
  const cells: (Cell | undefined)[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => undefined))
  const bits: number[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => 0))
  const bitColor: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => DIM))
  // Braille space: 2 dots per cell across, 4 down.
  const cx = W // dots
  const cy = H * 2
  const dot = (x: number, y: number, c: string) => {
    // Every orbit lies inside the field; only a point that is not a number misses it.
    const dx = Math.round(x)
    const dy = Math.round(y)
    const col = Math.floor(dx / 2)
    const row = Math.floor(dy / 4)
    const r = bits[row]
    const rc = bitColor[row]
    if (!r || !rc) return
    r[col] = r[col]! | (dx % 2 === 0 ? LEFT : RIGHT)[dy % 4]!
    rc[col] = c
  }
  const put = (x: number, y: number, ch: string, c: string, b?: boolean) => {
    const col = Math.floor(Math.round(x) / 2)
    const row = Math.floor(Math.round(y) / 4)
    const line = cells[row]
    if (line && col >= 0 && col < W) line[col] = { ch, c, b }
  }

  // Orbits: the outer ring holds the finished; running agents use up to 3 inner ones.
  const outerRx = W - 1.5
  const outerRy = H * 2 - 0.6
  const running = agents.filter(a => a.status === 'run')
  const lanes = Math.max(1, Math.min(3, running.length))
  const orbit = (k: number) => {
    const f = (k + 1) / (lanes + 1)
    return { rx: Math.max(3, outerRx * (0.3 + 0.62 * f)), ry: Math.max(1.2, outerRy * (0.3 + 0.62 * f)) }
  }
  const ellipse = (rx: number, ry: number, every: number, c: string, phase = 0) => {
    const n = Math.max(12, Math.round(TAU * Math.sqrt((rx * rx + ry * ry) / 2)))
    for (let i = 0; i < n; i++) {
      if ((i + phase) % every !== 0) continue
      const a = (i / n) * TAU
      dot(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, c)
    }
  }
  ellipse(outerRx, outerRy, 3, mix(DIM, '#000000', 0.15), Math.floor(t / 600) % 3)
  for (let k = 0; k < lanes; k++) {
    const { rx, ry } = orbit(k)
    ellipse(rx, ry, 2, DIM)
  }

  // The sun: a flickering star, a corona that breathes with the main loop's output.
  const heat = Math.min(1, sunTps / 80)
  const speed = isWorking ? 140 - heat * 70 : 420
  const phase = Math.floor(t / speed)
  const corona = 2.6 + Math.sin(t / (isWorking ? 260 : 900)) * 0.5
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + t / 2400
    if (noise(i, phase) < 0.3) continue
    dot(cx + Math.cos(a) * corona * 1.9, cy + Math.sin(a) * corona, mix(KZ.amber, DIM, 0.35))
  }
  const sunGlyph = isWorking ? '✶✷✸✹✸✷'.charAt(phase % 6) : '✺'
  put(cx, cy - 0.5, sunGlyph, isWorking ? mix(KZ.yellow, KZ.amber, 0.5 + 0.5 * Math.sin(t / 180)) : KZ.amber, true)

  // The finished, settled on the outer ring by spawn order.
  for (const a of agents) {
    if (a.status === 'run') continue
    const ang = a.order * 2.39996 + 0.6
    const x = cx + Math.cos(ang) * outerRx
    const y = cy + Math.sin(ang) * outerRy
    if (a.status === 'fail') {
      const fresh = t - (a.end ?? 0) < 3000
      const on = !fresh || Math.floor(t / 180) % 2 === 0
      put(x, y, '✖', fresh ? (on ? KZ.red : mix(KZ.red, DIM, 0.6)) : mix(KZ.red, DIM, 0.55), fresh && on)
    } else {
      put(x, y, '•', mix(agentColor(a.order), DIM, 0.55))
    }
  }

  // The running, each on its lane, with a comet tail.
  running.sort((a, b) => a.order - b.order).forEach((a, i) => {
    const { rx, ry } = orbit(i % lanes)
    const ang = angleAt(a, snapNow, t)
    const c = agentColor(a.order)
    for (let j = 1; j <= 4; j++) {
      const ta = ang - j * 0.16 * Math.sign(a.omega || 1)
      dot(cx + Math.cos(ta) * rx, cy + Math.sin(ta) * ry, mix(c, DIM, j * 0.18))
    }
    put(cx + Math.cos(ang) * rx, cy + Math.sin(ang) * ry, planetGlyph(a.type), c, true)
  })

  return cells.map((line, y) => {
    const segs: Seg[] = []
    for (let x = 0; x < W; x++) {
      const cell = line[x]
      const b = bits[y]![x]!
      const ch = cell ? cell.ch : b ? String.fromCharCode(0x2800 + b) : ' '
      const c = cell ? cell.c : b ? bitColor[y]![x] : undefined
      const bold = cell?.b
      const last = segs[segs.length - 1]
      if (last && last.c === c && last.b === bold) last.s += ch
      else segs.push({ s: ch, c, b: bold })
    }
    return segs
  })
}

/** The legend's lines: a header and up to `rows - 1` agents, each fitted to `w` columns. */
export function legendLines(agents: readonly Agent[], now: number, w: number, rows: number): Seg[][] {
  const running = agents.filter(a => a.status === 'run').length
  const done = agents.filter(a => a.status === 'done').length
  const failed = agents.filter(a => a.status === 'fail').length
  const head: Seg[] = [
    { s: 'orrery ', c: KZ.amber, b: true },
    { s: `${running} orbiting`, c: running ? KZ.violet : undefined, d: !running },
    { s: ` · ${done} done`, d: true },
  ]
  if (failed) head.push({ s: ` · ${failed} failed`, c: KZ.red })
  const lines: Seg[][] = [head]
  for (const a of legendAgents(agents, Math.max(0, rows - 1))) {
    const c = agentColor(a.order)
    const mark = a.status === 'run' ? planetGlyph(a.type) : a.status === 'fail' ? '✖' : '✓'
    const tail = `${a.type} · ${fmtClock(elapsedOf(a, now))}${a.status === 'run' && a.tps >= 1 ? ` · ${Math.round(a.tps)} t/s` : ''}`
    const room = Math.max(4, w - tail.length - 4)
    lines.push([
      { s: `${mark} `, c: a.status === 'fail' ? KZ.red : a.status === 'run' ? c : mix(c, DIM, 0.5), b: a.status === 'run' },
      { s: clip(a.desc || a.type, room).padEnd(Math.min(room, Math.max(4, (a.desc || a.type).length))), d: a.status !== 'run' },
      { s: `  ${tail}`, d: true },
    ])
  }
  return lines
}

/** The desktop drawing: a dark sky with dotted orbits, a pulsing sun, planets on CSS orbits, and a legend. */
export function orrerySvg(agents: readonly Agent[], now: number, sunTps: number, isWorking: boolean, W: number, H: number): string {
  const FW = Math.round(Math.min(W * 0.48, 380))
  const cx = FW / 2
  const cy = H / 2
  const outerRx = FW / 2 - 14
  const outerRy = H / 2 - 9
  const k = outerRy / outerRx
  const running = agents.filter(a => a.status === 'run').sort((a, b) => a.order - b.order)
  const lanes = Math.max(1, Math.min(3, running.length))
  const laneRx = (i: number) => outerRx * (0.32 + 0.6 * ((i + 1) / (lanes + 1)))
  const parts: string[] = []
  const css: string[] = [
    `.orsky{fill:#0b0e1a}@media (prefers-color-scheme: dark){.orsky{fill:#070912}}`,
    `.orring{fill:none;stroke:#8b93a7;stroke-opacity:.35;stroke-width:1.2;stroke-dasharray:1 5;stroke-linecap:round}`,
    `.orouter{fill:none;stroke:#8b93a7;stroke-opacity:.22;stroke-width:1;stroke-dasharray:1 3;stroke-linecap:round;transform-origin:${cx}px ${cy}px;animation:orturn 120s linear infinite}`,
    `@keyframes orturn{to{transform:rotate(360deg)}}`,
    `.orbit{transform-origin:0 0;animation:orspin linear infinite}`,
    `.orbitr{transform-origin:0 0;animation:orspin linear infinite reverse}`,
    `@keyframes orspin{to{transform:rotate(360deg)}}`,
    `.orsun{transform-box:fill-box;transform-origin:center;animation:orsun ${isWorking ? Math.max(0.7, 2.2 - sunTps / 60).toFixed(2) : 4}s ease-in-out infinite}`,
    `@keyframes orsun{50%{transform:scale(1.18);opacity:.85}}`,
    `.ortw{animation:ortw 3s ease-in-out infinite}@keyframes ortw{50%{opacity:.15}}`,
    `.orflash{animation:orfl .36s steps(2) 8}@keyframes orfl{50%{opacity:.1}}`,
  ]
  parts.push(`<defs>`,
    `<radialGradient id="orSunG"><stop offset="0" stop-color="#fff7d6"/><stop offset=".35" stop-color="${KZ.yellow}"/><stop offset=".75" stop-color="${KZ.amber}" stop-opacity=".55"/><stop offset="1" stop-color="${KZ.amber}" stop-opacity="0"/></radialGradient>`,
    `<filter id="orGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `</defs>`)
  parts.push(`<rect class="orsky" x="0" y="0" width="${FW}" height="${H}" rx="12"/>`)
  // Stars, seeded so they stay put across redraws.
  for (let i = 0; i < Math.round(FW / 9); i++) {
    const sx = noise(i, 1) * FW
    const sy = noise(i, 2) * H
    const r = 0.4 + noise(i, 3) * 0.8
    parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(2)}" fill="#e2e8f0" opacity="${(0.25 + noise(i, 4) * 0.5).toFixed(2)}"${noise(i, 5) > 0.7 ? ` class="ortw" style="animation-delay:-${(noise(i, 6) * 3).toFixed(2)}s"` : ''}/>`)
  }
  parts.push(`<ellipse class="orouter" cx="${cx}" cy="${cy}" rx="${outerRx}" ry="${outerRy}"/>`)
  for (let i = 0; i < lanes; i++) parts.push(`<ellipse class="orring" cx="${cx}" cy="${cy}" rx="${laneRx(i).toFixed(1)}" ry="${(laneRx(i) * k).toFixed(1)}"/>`)

  // The sun.
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(H * 0.2).toFixed(1)}" fill="url(#orSunG)" opacity=".55" class="orsun"/>`)
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(H * 0.075).toFixed(1)}" fill="url(#orSunG)" filter="url(#orGlow)"/>`)

  // The finished on the outer ring.
  for (const a of agents) {
    if (a.status === 'run') continue
    const ang = a.order * 2.39996 + 0.6
    const x = cx + Math.cos(ang) * outerRx
    const y = cy + Math.sin(ang) * outerRy
    if (a.status === 'fail') {
      const fresh = now - (a.end ?? 0) < 4000
      parts.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="middle" fill="${KZ.red}" opacity="${fresh ? 1 : 0.45}"${fresh ? ' class="orflash"' : ''} font-family="sans-serif">✖</text>`)
    } else {
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${agentColor(a.order)}" opacity=".45"/>`)
    }
  }

  // The running: rotate a lane around the sun, counter-rotate the planet so it
  // stays round under the ellipse's squash. A negative delay starts it where it is.
  running.forEach((a, i) => {
    const rx = laneRx(i % lanes)
    const c = agentColor(a.order)
    const period = Math.max(1.2, Math.min(60, TAU / Math.max(0.05, a.omega)))
    const ang = (((angleAt(a, now, now) % TAU) + TAU) % TAU)
    const delay = `-${((ang / TAU) * period).toFixed(2)}s`
    const style = `animation-duration:${period.toFixed(2)}s;animation-delay:${delay}`
    const tail = [0.14, 0.28, 0.42, 0.56].map((d, j) => `<circle cx="${(Math.cos(-d) * rx).toFixed(1)}" cy="${(Math.sin(-d) * rx).toFixed(1)}" r="${(2.6 - j * 0.5).toFixed(1)}" fill="${c}" opacity="${(0.5 - j * 0.11).toFixed(2)}"/>`).join('')
    parts.push(
      `<g transform="translate(${cx} ${cy}) scale(1 ${k.toFixed(4)})"><g class="orbit" style="${style}">${tail}`,
      `<g transform="translate(${rx.toFixed(1)} 0)"><g class="orbitr" style="${style}"><g transform="scale(1 ${(1 / k).toFixed(4)})">`,
      `<circle r="${(4.2 + Math.min(2, a.tps / 60)).toFixed(1)}" fill="${c}" filter="url(#orGlow)"/>`,
      `</g></g></g></g></g>`,
    )
  })

  // Legend, on the theme's panel.
  const LX = FW + 10
  const LW = W - LX
  parts.push(`<rect class="p" x="${LX}" y="0" width="${LW}" height="${H}" rx="12"/>`)
  const nRun = running.length
  const nDone = agents.filter(a => a.status === 'done').length
  const nFail = agents.filter(a => a.status === 'fail').length
  parts.push(svgText(LX + 12, 18, 'ORRERY', { size: 10, weight: 700, fill: KZ.amber }))
  parts.push(svgText(LX + 64, 18, `${nRun} orbiting · ${nDone} done${nFail ? ` · ${nFail} failed` : ''}`, { cls: 's', size: 10.5 }))
  const list = legendAgents(agents, 4)
  const lh = (H - 28) / 4
  list.forEach((a, i) => {
    const y = 28 + i * lh + lh / 2 + 4
    const c = agentColor(a.order)
    if (a.status === 'run') parts.push(`<circle cx="${LX + 17}" cy="${y - 4}" r="4" fill="${c}" class="pulse"/>`)
    else parts.push(svgText(LX + 17, y, a.status === 'fail' ? '✖' : '✓', { size: 11, anchor: 'middle', fill: a.status === 'fail' ? KZ.red : c }))
    const right = `${a.type} · ${fmtClock(elapsedOf(a, now))}${a.status === 'run' && a.tps >= 1 ? ` · ${Math.round(a.tps)} t/s` : ''}`
    const rightW = right.length * 6
    parts.push(svgText(LX + 30, y, fitText(a.desc || a.type, 12, Math.max(40, LW - 52 - rightW)), { cls: a.status === 'run' ? 't' : 's', size: 12, weight: a.status === 'run' ? 600 : 400 }))
    parts.push(svgText(W - 12, y, right, { cls: 'm', size: 10.5, anchor: 'end' }))
  })
  return svg(W, H, parts.join(''), css.join('\n'))
}

export function orreryAlt(agents: readonly Agent[]): string {
  const run = agents.filter(a => a.status === 'run')
  return `Subagent orrery: ${run.length} running${run.length ? ` (${run.map(a => a.desc || a.type).join(', ')})` : ''}, ${agents.filter(a => a.status === 'done').length} done, ${agents.filter(a => a.status === 'fail').length} failed.`
}


// Halo's desktop line: one SVG, every motion a CSS animation.
import type { HaloSnap } from '../types'
import { mix, svg, svgText, textWidth } from './lib/kz.ts'

const H = 16

export function haloSvg(s: HaloSnap, width: number, now: number): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(120, width)
  const c = s.color
  const labelW = s.label ? textWidth(s.label, 10) + 14 : 0
  const x0 = labelW
  const lw = W - x0
  const y = H / 2
  const p: string[] = []
  const css: string[] = []
  p.push(`<defs><filter id="hg" x="-5%" y="-200%" width="110%" height="500%"><feGaussianBlur stdDeviation="2.4"/></filter>`)
  p.push(`<clipPath id="hc"><rect x="${x0}" y="${y - 2}" width="${lw}" height="4" rx="2"/></clipPath>`)
  p.push(`<clipPath id="hcg"><rect x="${x0 - 4}" y="0" width="${lw + 8}" height="${H}"/></clipPath>`)
  const line = (fill: string, extra = '') => `<rect x="${x0}" y="${y - 1.5}" width="${lw}" height="3" rx="1.5" fill="${fill}" ${extra}/>`

  switch (s.mood) {
    case 'idle': {
      css.push('.br{animation:hbr 5s ease-in-out infinite}@keyframes hbr{50%{opacity:.35}}')
      p.push(`</defs><g class="br"><g clip-path="url(#hcg)">${line(c, 'filter="url(#hg)" opacity=".6"')}</g>${line(c)}</g>`)
      break
    }
    case 'flow': {
      // A repeating violet gradient three widths long, sliding right forever.
      const deep = mix(c, '#4c1d95', 0.5)
      const light = mix(c, '#f5f3ff', 0.5)
      p.push(`<linearGradient id="hf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="180" y2="0" spreadMethod="repeat"><stop offset="0" stop-color="${deep}"/><stop offset=".5" stop-color="${light}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>`)
      css.push('.fl{animation:hfl 1.6s linear infinite}@keyframes hfl{from{transform:translateX(-180px)}to{transform:translateX(0)}}')
      const band = `<rect class="fl" x="${x0}" y="0" width="${lw + 180}" height="${H}" fill="url(#hf)"/>`
      p.push(`<g clip-path="url(#hcg)" filter="url(#hg)" opacity=".55"><g clip-path="url(#hc)">${band}</g></g><g clip-path="url(#hc)">${band}</g>`)
      break
    }
    case 'think': {
      css.push('.sh{animation:hsh 1.1s ease-in-out infinite}@keyframes hsh{from{transform:translateX(-80px)}to{transform:translateX(' + (lw + 80) + 'px)}}')
      css.push('.sp{animation:hsp 1.4s ease-in-out infinite;opacity:0}@keyframes hsp{40%{opacity:1}80%{opacity:0}}')
      p.push(`<linearGradient id="hs" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`)
      p.push(`<g clip-path="url(#hcg)">${line(c, 'filter="url(#hg)" opacity=".7"')}</g>${line(c)}`)
      p.push(`<g clip-path="url(#hc)"><rect class="sh" x="${x0}" y="0" width="80" height="${H}" fill="url(#hs)"/></g>`)
      for (let i = 0; i < Math.min(28, Math.floor(lw / 40)); i++) {
        const sx = x0 + ((i * 97.13) % lw)
        p.push(`<circle class="sp" cx="${sx.toFixed(1)}" cy="${y + ((i % 3) - 1) * 2.5}" r="1.5" fill="${mix(c, "#ffffff", 0.7)}" style="animation-delay:${((i * 0.37) % 1.4).toFixed(2)}s"/>`)
      }
      break
    }
    case 'tool': {
      // The tool's color dim along the line, and a bright comet racing across.
      p.push(`<linearGradient id="ht" x1="0" x2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset=".85" stop-color="${mix(c, '#ffffff', 0.25)}"/><stop offset="1" stop-color="${mix(c, "#ffffff", 0.55)}"/></linearGradient></defs>`)
      css.push(`.cm{animation:hcm 1.3s cubic-bezier(.5,0,.5,1) infinite}@keyframes hcm{from{transform:translateX(-140px)}to{transform:translateX(${lw + 20}px)}}`)
      p.push(line(c, 'opacity=".35"'))
      p.push(`<g clip-path="url(#hcg)"><rect class="cm" x="${x0}" y="${y - 3}" width="140" height="6" rx="3" fill="url(#ht)" filter="url(#hg)"/></g>`)
      p.push(`<g clip-path="url(#hc)"><rect class="cm" x="${x0}" y="0" width="140" height="${H}" fill="url(#ht)"/></g>`)
      break
    }
    case 'error': {
      // A strobe that runs for what is left of the four seconds, then rests.
      const left = Math.max(0.2, 4 - (now - s.since) / 1000)
      css.push(`.er{animation:her .22s steps(2,jump-none) ${Math.round(left / 0.22)}}@keyframes her{50%{opacity:.25}}`)
      p.push(`</defs><g class="er"><g clip-path="url(#hcg)">${line(c, 'filter="url(#hg)"')}</g>${line(c)}</g>`)
      break
    }
    case 'wait': {
      css.push('.wt{animation:hwt 1s ease-in-out infinite}@keyframes hwt{0%,50%{opacity:1}65%,100%{opacity:.15}}')
      p.push(`</defs><g class="wt"><g clip-path="url(#hcg)">${line(c, 'filter="url(#hg)"')}</g>${line(c)}</g>`)
      break
    }
  }
  if (s.label) p.push(svgText(0, y + 3.5, s.label, { size: 10, weight: 700, fill: c }))
  return { source: svg(W, H, p.join(''), css.join('')), width: W, height: H, alt: altOf(s) }
}

export function altOf(s: HaloSnap): string {
  return `Halo: ${s.mood === 'idle' ? 'idle' : s.label}`
}

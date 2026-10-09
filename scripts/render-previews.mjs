// Turns the trees scripts/capture-previews.mjs collected into README images.
//   node scripts/render-previews.mjs [mod ...]
// Each drawing becomes an HTML page (a terminal window or a desktop panel),
// screenshotted with the locally installed Chrome through playwright-core into
// docs/previews/<mod>-<component>-<surface>.png. Desktop drawings are taken in
// light and dark. Every Svg a mod drew is also kept as its own animated .svg.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, 'docs', 'previews', '_work')
const outDir = join(root, 'docs', 'previews')
mkdirSync(outDir, { recursive: true })

const THEME = {
  text: '#e6e6e6', inverseText: '#111', inactive: '#8a8a8a', subtle: '#5c5c5c', suggestion: '#b1b9f9', remember: '#b1b9f9',
  success: '#4eba65', error: '#ff6b80', warning: '#ffc107', merged: '#af87ff', claude: '#d77757', permission: '#b1b9f9',
  planMode: '#48968c', autoAccept: '#af87ff', promptBorder: '#888', bashBorder: '#fd5db1', ide: '#4782ff',
  diffAdded: '#225c2b', diffRemoved: '#7a2936', diffAddedDimmed: '#47584a', diffRemovedDimmed: '#69484d', diffAddedWord: '#38a660', diffRemovedWord: '#b3596b',
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const color = c => (typeof c === 'string' ? (THEME[c] ?? c) : undefined)

function decodeRaster(props) {
  const bin = Buffer.from(String(props.cells ?? ''), 'base64')
  const w = new Uint32Array(bin.buffer, bin.byteOffset, Math.floor(bin.length / 4))
  const cols = props.columns, rows = props.rows
  const hex = v => (v & 0x01000000 ? null : '#' + (v & 0xffffff).toString(16).padStart(6, '0'))
  let html = ''
  for (let y = 0; y < rows; y++) {
    html += '<div class="row">'
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 3
      const ch = String.fromCodePoint(w[i] || 32)
      const fg = hex(w[i + 1] ?? 0x01000000), bg = hex(w[i + 2] ?? 0x01000000)
      html += `<span style="${fg ? `color:${fg};` : ''}${bg ? `background:${bg};` : ''}">${esc(ch)}</span>`
    }
    html += '</div>'
  }
  return `<div class="raster">${html}</div>`
}

const cells = (v, unit) => (typeof v === 'number' ? `${v}${unit}` : typeof v === 'string' ? v : undefined)

function boxStyle(p, surface) {
  const s = []
  if (p.display === 'none') s.push('display:none')
  else s.push('display:flex')
  s.push(`flex-direction:${p.flexDirection ?? 'row'}`)
  if (surface !== 'terminal' || p.flexWrap) s.push(`flex-wrap:${p.flexWrap ?? 'wrap'}`)
  const CH = 'ch', LN = 'lh'
  const v = (k, css, unit) => p[k] !== undefined && s.push(`${css}:${cells(p[k], unit)}`)
  v('width', 'width', CH); v('minWidth', 'min-width', CH); v('height', 'height', LN); v('minHeight', 'min-height', LN)
  if (p.gap !== undefined) s.push(`gap:${p.flexDirection?.startsWith('column') ? p.gap + LN : p.gap + CH}`)
  v('columnGap', 'column-gap', CH); v('rowGap', 'row-gap', LN)
  v('flexGrow', 'flex-grow', ''); v('flexShrink', 'flex-shrink', '')
  if (p.alignItems) s.push(`align-items:${p.alignItems}`)
  if (p.alignSelf) s.push(`align-self:${p.alignSelf}`)
  if (p.justifyContent) s.push(`justify-content:${p.justifyContent}`)
  for (const [k, css, unit] of [['margin', 'margin', null], ['padding', 'padding', null]]) {
    void unit
    const all = p[k], x = p[`${k}X`] ?? all, y = p[`${k}Y`] ?? all
    const t = p[`${k}Top`] ?? y, b = p[`${k}Bottom`] ?? y, l = p[`${k}Left`] ?? x, r = p[`${k}Right`] ?? x
    if ([t, r, b, l].some(n => n !== undefined)) s.push(`${css}:${t ?? 0}lh ${r ?? 0}ch ${b ?? 0}lh ${l ?? 0}ch`)
  }
  if (p.borderStyle) {
    const style = p.borderStyle === 'double' ? 'double' : p.borderStyle === 'dashed' ? 'dashed' : 'solid'
    s.push(`border:${p.borderStyle === 'double' ? 3 : 1}px ${style} ${color(p.borderColor) ?? 'currentColor'}`)
    if (p.borderStyle === 'round') s.push('border-radius:6px')
    if (p.borderDimColor) s.push('border-color:#555')
  }
  if (p.backgroundColor) s.push(`background:${color(p.backgroundColor)}`)
  if (p.overflow === 'hidden') s.push('overflow:hidden')
  if (p.position === 'absolute') {
    s.push('position:absolute')
    for (const k of ['top', 'left', 'right', 'bottom']) if (p[k] !== undefined) s.push(`${k}:${p[k]}${k === 'top' || k === 'bottom' ? 'lh' : 'ch'}`)
  }
  return s.join(';')
}

function textStyle(p) {
  const s = []
  let fg = color(p.color), bg = color(p.backgroundColor)
  if (p.inverse) [fg, bg] = [bg ?? 'var(--bg)', fg ?? 'var(--fg)']
  if (fg) s.push(`color:${fg}`)
  if (bg) s.push(`background:${bg}`)
  if (p.bold) s.push('font-weight:700')
  if (p.italic) s.push('font-style:italic')
  const deco = [p.underline && 'underline', p.strikethrough && 'line-through'].filter(Boolean)
  if (deco.length) s.push(`text-decoration:${deco.join(' ')}`)
  if (p.dimColor) s.push('opacity:.55')
  return s.join(';')
}

function render(node, surface, inText = false) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (Array.isArray(node)) return node.map(n => render(n, surface, inText)).join('')
  const p = node.props ?? {}
  const kids = c => render(node.children, surface, c)
  switch (node.type) {
    case 'Box': return `<div class="box" style="${boxStyle(p, surface)}">${kids(false)}</div>`
    case 'Text': {
      const trunc = String(p.wrap ?? '').startsWith('truncate') || p.wrap === 'end' || p.wrap === 'middle'
      return `<span class="txt${trunc && !inText ? ' trunc' : ''}" style="${textStyle(p)}">${kids(true)}</span>`
    }
    case 'Button': {
      const label = esc(p.label ?? '')
      if (surface === 'terminal') {
        const hk = p.hotkey ? `${esc(p.hotkey)}: ` : ''
        const c = p.variant === 'primary' ? 'color:#d77757;' : ''
        return `<span class="tbtn" style="${c}${p.dimColor ? 'opacity:.55' : ''}">${p.plain ? hk + label : `[ ${hk}${label} ]`}</span>`
      }
      return `<span class="dbtn${p.variant === 'primary' ? ' primary' : ''}${p.plain ? ' plain' : ''}">${p.role === 'dismiss' && !label ? '✕' : label}</span>`
    }
    case 'Link': return `<span class="link">${esc(p.label ?? '')}${kids(true)}</span>`
    case 'Code': return `<pre class="code">${esc(p.source ?? '')}</pre>`
    case 'Markdown': return `<div class="md">${esc(p.text ?? p.source ?? '').replace(/\n/g, '<br>')}</div>`
    case 'Input': return `<span class="input">${esc(p.value ?? p.placeholder ?? '')}</span>`
    case 'Select': return `<span class="input">${esc((p.options ?? []).find(o => o.value === p.value)?.label ?? p.value ?? '')} ▾</span>`
    case 'Raster': return decodeRaster(p)
    case 'Image': return `<span class="txt" style="opacity:.6">[${esc(p.alt ?? 'image')}]</span>`
    case 'Svg': {
      const w = p.width ?? '', h = p.height ?? ''
      return `<img class="svg" src="data:image/svg+xml;base64,${Buffer.from(String(p.source ?? '')).toString('base64')}" ${w ? `width="${w}"` : ''} ${h ? `height="${h}"` : ''}/>`
    }
    case 'ClientFrame': {
      const w = cells(p.width, 'ch'), h = cells(p.height, 'lh')
      return `<div class="box" style="display:flex;flex-direction:column;${w ? `width:${w};` : ''}${h ? `min-height:${h};` : ''}">${render(node.children, surface)}</div>`
    }
    default: return kids(inText)
  }
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;padding:28px;background:transparent;font-synthesis:none}
.txt{white-space:pre}.trunc{overflow:hidden;text-overflow:ellipsis;min-width:0}
.box{min-width:0}
.row{display:flex;height:1lh}.row span{display:inline-block;width:1ch;text-align:center;white-space:pre}
.raster{line-height:1lh}
.code{margin:0;font:inherit;white-space:pre}
.link{text-decoration:underline;color:#7aa2ff}
.input{border:1px solid #666;padding:0 1ch}
/* terminal */
.term{--bg:#0e1015;--fg:#e6e6e6;background:var(--bg);color:var(--fg);font-family:'Cascadia Code','Cascadia Mono',Consolas,monospace;font-size:14px;line-height:1.22;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 0 1px #2a2d36;overflow:hidden;display:inline-block}
.term .bar{height:34px;background:#171a21;display:flex;align-items:center;gap:8px;padding:0 14px;font-family:'Segoe UI',sans-serif;font-size:12px;color:#8b90a0}
.term .dot{width:12px;height:12px;border-radius:50%}
.term .body{padding:14px 18px 16px}
.term .dim{opacity:.45}
.term .prompt{border:1px solid #555;border-radius:6px;padding:0 1ch;margin-top:.4lh}
.term .side{display:flex}
.term .side .left{width:44ch;opacity:.38;padding-right:2ch;border-right:1px solid #2c2f38;margin-right:2ch;white-space:pre;overflow:hidden}
.term .ptitle{color:#d77757;font-weight:700;margin-bottom:.5lh}
.tbtn{white-space:pre}
/* desktop */
.desk{--bg:#faf9f7;--fg:#1f1f1f;--card:#fff;--line:#e8e6e1;background:var(--bg);color:var(--fg);font-family:'Segoe UI',Inter,-apple-system,sans-serif;font-size:13px;line-height:1.45;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.18),0 0 0 1px var(--line);overflow:hidden;display:inline-block}
.dark .desk{--bg:#262624;--fg:#ececea;--card:#30302e;--line:#3a3a38}
.desk .head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
.desk .body{padding:14px 16px}
.desk .box{gap:6px}
.dbtn{display:inline-flex;align-items:center;padding:3px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);font-size:12px;white-space:nowrap}
.dbtn.primary{background:#d97757;color:#fff;border-color:#d97757}.dbtn.plain{border-color:transparent;background:transparent}
.desk .composer{margin-top:10px;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;color:#9a9a96}
.svg{display:block;max-width:none}
`

const FAKE_LEFT = [
  '⏺ I mapped the band composer: two mods', '  overwrite each other unless each one', '  composes next(e). Fixing that now.', '',
  '⏺ Update(src/engine/orbit.ts)', '  ⎿  Updated with 4 additions', '', '⏺ Write(src/engine/warp.ts)', '  ⎿  Wrote 40 lines', '',
  '⏺ Bash(npm test)', '  ⎿  Tests: 3 failed, 139 passed', '', '⏺ 3 agents launched', '  ⎿  Audit band composition', '     Port gauges to SVG', '     Write orbit tests',
].join('\n')

function page(shot) {
  const { mod, component, surface } = shot
  const inner = render(shot.tree, surface)
  if (surface === 'terminal') {
    const bar = `<div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span style="margin-left:10px">claude — ~/work/kozmos · ${esc(mod)}</span></div>`
    let body
    if (component === 'Pane') body = `<div class="side"><div class="left">${esc(FAKE_LEFT)}</div><div style="width:52ch"><div class="ptitle">▍${esc(mod)}</div>${inner}</div></div>`
    else if (component === 'AbovePrompt') body = `<div style="width:108ch"><div class="dim">⏺ Bash(npm run test:e2e)</div><div class="dim">  ⎿  Running the end-to-end tests…</div><div style="margin-top:.5lh">${inner}</div><div class="prompt">&gt; <span class="dim">make the orbit engine faster</span></div><div class="dim" style="font-size:12px">  ⏵⏵ auto mode on · ? for shortcuts</div></div>`
    else body = `<div style="width:108ch"><div class="dim">⏺ Bash(npm run test:e2e)</div>${inner}<div class="prompt">&gt; </div></div>`
    return `<div id="shot" class="term">${bar}<div class="body">${body}</div></div>`
  }
  const head = `<div class="head"><span style="color:#d97757">◆</span>${esc(component === 'Pane' ? mod : `${mod} · ${component}`)}</div>`
  const width = component === 'Pane' ? 460 : 860
  const tail = component === 'AbovePrompt' ? '<div class="composer">Reply to Claude…</div>' : ''
  return `<div id="shot" class="desk" style="width:${width}px">${head}<div class="body">${inner}${tail}</div></div>`
}

const argv = process.argv.slice(2)
const isFrames = argv[0] === '--frames'
const only = isFrames ? argv.slice(1) : argv
const browser = await chromium.launch({ channel: 'chrome' })

// --frames: each <mod>.frames.json strip becomes video/frames/<mod>/NNNN.png.
if (isFrames) {
  const strips = readdirSync(work).filter(f => f.endsWith('.frames.json') && (!only.length || only.includes(f.replace(/\.frames\.json$/, ''))))
  const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: 'dark', viewport: { width: 1500, height: 1200 } })
  const pg = await ctx.newPage()
  for (const f of strips) {
    const mod = f.replace(/\.frames\.json$/, '')
    const dir = join(root, 'video', 'frames', mod)
    mkdirSync(dir, { recursive: true })
    const frames = JSON.parse(readFileSync(join(work, f), 'utf8'))
    for (const fr of frames) {
      await pg.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><body class="dark">${page(fr)}</body>`)
      await pg.locator('#shot').screenshot({ path: join(dir, `${String(fr.i).padStart(4, '0')}.png`), omitBackground: true })
    }
    console.log(`${mod}: ${frames.length} frames`)
  }
  await browser.close()
  process.exit(0)
}

const files = readdirSync(work).filter(f => f.endsWith('.json') && !f.endsWith('.frames.json') && (!only.length || only.includes(f.replace(/\.json$/, ''))))
const made = []
for (const f of files) {
  const shots = JSON.parse(readFileSync(join(work, f), 'utf8')).filter(s => !s.error && s.tree)
  for (const shot of shots) {
    const base = `${shot.mod}-${shot.component.toLowerCase()}-${shot.surface}`
    const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${page(shot)}</body>`
    const themes = shot.surface === 'desktop' ? ['light', 'dark'] : ['dark']
    for (const theme of themes) {
      const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: theme, viewport: { width: 1500, height: 1200 } })
      const pg = await ctx.newPage()
      const file = join(work, `${base}-${theme}.html`)
      writeFileSync(file, html.replace('<body>', `<body class="${theme}">`))
      await pg.goto(pathToFileURL(file).href)
      await pg.waitForTimeout(150)
      const name = shot.surface === 'desktop' ? `${base}-${theme}.png` : `${base}.png`
      await pg.locator('#shot').screenshot({ path: join(outDir, name), omitBackground: true, animations: 'disabled' })
      made.push(name)
      await ctx.close()
    }
    // The desktop's own animated SVGs, kept as files for the README.
    if (shot.surface === 'desktop' && shot.component === 'AbovePrompt') {
      let n = 0
      const walk = node => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(walk)
        if (node.type === 'Svg' && node.props?.source && n === 0) writeFileSync(join(outDir, `${base}.svg`), node.props.source), n++
        walk(node.children)
      }
      walk(shot.tree)
    }
  }
}
await browser.close()
console.log(`${made.length} images → docs/previews/`)

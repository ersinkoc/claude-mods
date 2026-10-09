// The shared kit (shared/kz.ts and shared/probe.ts), tested through kozmos's
// synced copy. Every exported function, every branch, exact outputs.
import { describe, expect, test } from 'claude-code/testing'
import {
  Canvas, DEFAULT_COLOR, FONT, KZ, MONO, SVG_BASE_CSS, bar, baseName, brailleGraph, clamp01, clip, contextOf, costOf,
  fitText, fmtClock, fmtPct, fmtSpan, fmtTokens, fmtUsd, hash, heat, hexToInt, hexToRgb, hue, limitLabel, mix, modelName,
  noise, padEnd, padStart, pips, priceOf, pxOf, rgbToHex, rng, sparkline, svg, svgBar, svgText, textWidth, toBase64,
  tokensOf, toolColor, toolDetail, toolGlyph, toolName, untilReset, windowMs, windowOf, xml,
} from '../hooks/lib/kz.ts'
import {
  GIT_HEAD, GIT_NUMSTAT, GIT_STATUS, MAC_MEMSIZE, MAC_TOP, NO_GIT, NVIDIA_SMI, WIN_SYS, fmtBytes, gitLogArgv,
  parseGitLog, parseGitStatus, parseMacTop, parseMeminfo, parseNumstat, parseNvidia, parseProcStat, parseWinSys,
  platformFrom,
} from '../hooks/lib/probe.ts'

/** Packs raster words the way Canvas does, for exact comparisons. */
const words = (...w: number[]): string => toBase64(new Uint8Array(new Uint32Array(w).buffer))
const D = DEFAULT_COLOR
const SP = 0x20

describe('kz: tools', () => {
  test('toolColor gives every family its color', () => {
    for (const t of ['Bash', 'PowerShell']) expect(toolColor(t)).toBe(KZ.green)
    for (const t of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) expect(toolColor(t)).toBe(KZ.yellow)
    for (const t of ['Read', 'Glob', 'Grep', 'LSP']) expect(toolColor(t)).toBe(KZ.blue)
    for (const t of ['Agent', 'Task', 'Workflow']) expect(toolColor(t)).toBe(KZ.violet)
    for (const t of ['WebFetch', 'WebSearch']) expect(toolColor(t)).toBe(KZ.cyan)
    for (const t of ['TodoWrite', 'TaskCreate', 'TaskUpdate']) expect(toolColor(t)).toBe(KZ.teal)
    expect(toolColor('mcp__github__create_issue')).toBe(KZ.magenta)
    expect(toolColor('')).toBe(KZ.mist)
    expect(toolColor('bash')).toBe(KZ.mist)
  })

  test('toolGlyph gives every family its glyph', () => {
    expect(toolGlyph('Bash')).toBe('$')
    expect(toolGlyph('PowerShell')).toBe('$')
    for (const t of ['Edit', 'Write', 'NotebookEdit']) expect(toolGlyph(t)).toBe('✎')
    expect(toolGlyph('Read')).toBe('◉')
    expect(toolGlyph('Glob')).toBe('⌕')
    expect(toolGlyph('Grep')).toBe('⌕')
    expect(toolGlyph('Agent')).toBe('◈')
    expect(toolGlyph('WebFetch')).toBe('◍')
    expect(toolGlyph('TodoWrite')).toBe('☑')
    expect(toolGlyph('Task')).toBe('☑')
    expect(toolGlyph('mcp__x__y')).toBe('⬡')
    expect(toolGlyph('MultiEdit')).toBe('•')
    expect(toolGlyph('')).toBe('•')
  })

  test('toolName shortens mcp tools and keeps built-ins', () => {
    expect(toolName('mcp__github__create_issue')).toBe('github·create_issue')
    expect(toolName('mcp__a__b__c')).toBe('a·b·c')
    expect(toolName('Bash')).toBe('Bash')
    expect(toolName('')).toBe('')
  })

  test('toolDetail picks the field that says what a call is about', () => {
    expect(toolDetail('Bash', { command: 'ls   -la\n  /tmp' })).toBe('ls -la /tmp')
    expect(toolDetail('PowerShell', { description: 'List files', command: 'dir' })).toBe('List files')
    expect(toolDetail('Bash', { command: 'x'.repeat(80) })).toBe('x'.repeat(59) + '…')
    expect(toolDetail('Bash', null)).toBe('')
    expect(toolDetail('Bash', undefined)).toBe('')
    expect(toolDetail('Edit', { file_path: 'C:\\work\\src\\a.ts' })).toBe('a.ts')
    expect(toolDetail('Read', { file_path: '/home/u/ğü.md' })).toBe('ğü.md')
    expect(toolDetail('NotebookEdit', { notebook_path: '/x/n.ipynb' })).toBe('n.ipynb')
    expect(toolDetail('Agent', { subagent_type: 'Explore' })).toBe('Explore')
    expect(toolDetail('Agent', { description: 'Find the bug', subagent_type: 'Explore' })).toBe('Find the bug')
    expect(toolDetail('Agent', {})).toBe('')
    expect(toolDetail('Grep', { pattern: 'fo+' })).toBe('fo+')
    expect(toolDetail('WebFetch', { url: 'https://example.com/a?b=1' })).toBe('example.com/a?b=1')
    expect(toolDetail('WebFetch', { url: 'ftp://x' })).toBe('ftp://x')
    expect(toolDetail('WebSearch', { query: 'kozmos' })).toBe('kozmos')
    expect(toolDetail('TaskCreate', { subject: 'Ship it' })).toBe('Ship it')
    expect(toolDetail('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 todos')
    expect(toolDetail('TodoWrite', { todos: 'nope' })).toBe('')
    expect(toolDetail('mcp__srv__do_it', {})).toBe('srv · do_it')
    expect(toolDetail('Other', { pattern: 5, file_path: 7 })).toBe('')
  })
})

describe('kz: colors', () => {
  test('hexToRgb reads long, short and bare hex, and zeroes junk', () => {
    expect(hexToRgb('#a78bfa')).toEqual([167, 139, 250])
    expect(hexToRgb('abc')).toEqual([170, 187, 204])
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
    expect(hexToRgb('#zzz')).toEqual([0, 0, 0])
    expect(hexToRgb('')).toEqual([0, 0, 0])
  })

  test('rgbToHex rounds and clamps each channel', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(-5, 300, 127.6)).toBe('#00ff80')
    expect(rgbToHex(15.4, 16, 255)).toBe('#0f10ff')
  })

  test('mix blends and clamps t', () => {
    expect(mix('#000', '#fff', 0.5)).toBe('#808080')
    expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000')
    expect(mix('#102030', '#405060', NaN)).toBe('#102030')
  })

  test('heat runs green, yellow, red', () => {
    expect(heat(0)).toBe(KZ.green)
    expect(heat(0.3)).toBe('#a2d54b')
    expect(heat(0.6)).toBe(KZ.yellow)
    expect(heat(0.8)).toBe('#f99f43')
    expect(heat(1)).toBe(KZ.red)
    expect(heat(5)).toBe(KZ.red)
    expect(heat(NaN)).toBe(KZ.green)
  })

  test('hue wraps around and takes saturation and lightness', () => {
    expect(hue(0)).toBe('#e64c4c')
    expect(hue(0.5)).toBe('#4ce6e6')
    expect(hue(1.25)).toBe('#99e64c')
    expect(hue(-0.25, 1, 0.5)).toBe('#8000ff')
    expect(hue(0.3, 0, 0.5)).toBe('#808080')
  })

  test('hexToInt packs 0xRRGGBB', () => {
    expect(hexToInt('#a78bfa')).toBe(0xa78bfa)
    expect(hexToInt('#000')).toBe(0)
    expect(hexToInt('#ffffff')).toBe(0xffffff)
  })
})

describe('kz: numbers and text', () => {
  test('clamp01 clamps and zeroes non-finite', () => {
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(NaN)).toBe(0)
    expect(clamp01(Infinity)).toBe(0)
  })

  test('fmtTokens scales to k, M and B without rolling over to 1000 of a unit', () => {
    expect(fmtTokens(0)).toBe('0')
    expect(fmtTokens(999)).toBe('999')
    expect(fmtTokens(999.4)).toBe('999')
    expect(fmtTokens(999.5)).toBe('1.0k')
    expect(fmtTokens(1000)).toBe('1.0k')
    expect(fmtTokens(1500)).toBe('1.5k')
    expect(fmtTokens(9999)).toBe('10.0k')
    expect(fmtTokens(10_000)).toBe('10k')
    expect(fmtTokens(999_499)).toBe('999k')
    expect(fmtTokens(999_500)).toBe('1.0M')
    expect(fmtTokens(999_999)).toBe('1.0M')
    expect(fmtTokens(1_250_000)).toBe('1.3M')
    expect(fmtTokens(10_000_000)).toBe('10M')
    expect(fmtTokens(999_490_000)).toBe('999M')
    expect(fmtTokens(999_500_000)).toBe('1.0B')
    expect(fmtTokens(1e9)).toBe('1.0B')
    expect(fmtTokens(1.5e12)).toBe('1500.0B')
    expect(fmtTokens(-1500)).toBe('-1500')
    expect(fmtTokens(NaN)).toBe('—')
    expect(fmtTokens(Infinity)).toBe('—')
    expect(fmtTokens(-Infinity)).toBe('—')
  })

  test('fmtUsd shows cents, a floor and whole dollars', () => {
    expect(fmtUsd(0)).toBe('$0.00')
    expect(fmtUsd(0.004)).toBe('<$0.01')
    expect(fmtUsd(0.01)).toBe('$0.01')
    expect(fmtUsd(1.5)).toBe('$1.50')
    expect(fmtUsd(99.99)).toBe('$99.99')
    expect(fmtUsd(100)).toBe('$100')
    expect(fmtUsd(1234.5)).toBe('$1235')
    expect(fmtUsd(-2)).toBe('$-2.00')
    expect(fmtUsd(NaN)).toBe('$—')
    expect(fmtUsd(Infinity)).toBe('$—')
  })

  test('fmtClock shows m:ss and h:mm:ss', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(-500)).toBe('0:00')
    expect(fmtClock(42_000)).toBe('0:42')
    expect(fmtClock(59_600)).toBe('1:00')
    expect(fmtClock(187_000)).toBe('3:07')
    expect(fmtClock(3_753_000)).toBe('1:02:33')
    expect(fmtClock(100 * 3600_000)).toBe('100:00:00')
  })

  test('fmtSpan shows s, m, h+m and d+h', () => {
    expect(fmtSpan(0)).toBe('0s')
    expect(fmtSpan(-1)).toBe('0s')
    expect(fmtSpan(42_000)).toBe('42s')
    expect(fmtSpan(420_000)).toBe('7m')
    expect(fmtSpan(9_660_000)).toBe('2h41m')
    expect(fmtSpan(47 * 3600_000 + 59 * 60_000)).toBe('47h59m')
    expect(fmtSpan(48 * 3600_000)).toBe('2d0h')
    expect(fmtSpan(76 * 3600_000)).toBe('3d4h')
  })

  test('fmtPct rounds and dashes the unknown', () => {
    expect(fmtPct(42.6)).toBe('43%')
    expect(fmtPct(0)).toBe('0%')
    expect(fmtPct(-3)).toBe('-3%')
    expect(fmtPct(undefined)).toBe('—')
    expect(fmtPct(NaN)).toBe('—')
  })

  test('clip collapses whitespace and ellipsizes', () => {
    expect(clip('  a\n b   c ', 10)).toBe('a b c')
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('abcd', 4)).toBe('abcd')
    expect(clip('abc', 0)).toBe('a…')
    expect(clip('', 3)).toBe('')
  })

  test('padEnd and padStart give exactly n columns', () => {
    expect(padEnd('ab', 4)).toBe('ab  ')
    expect(padEnd('abcdef', 3)).toBe('abc')
    expect(padEnd('abc', 0)).toBe('')
    expect(padStart('ab', 4)).toBe('  ab')
    expect(padStart('abcdef', 3)).toBe('def')
    expect(padStart('abc', 3)).toBe('abc')
    expect(padStart('abc', 0)).toBe('')
  })

  test('modelName turns ids into family and version', () => {
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(modelName('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelName('claude-haiku-4-5')).toBe('Haiku 4.5')
    expect(modelName('FABLE-5')).toBe('Fable 5')
    expect(modelName('mythos-12-10')).toBe('Mythos 12.10')
    expect(modelName('opus-5-123')).toBe('Opus 5')
    expect(modelName('claude-instant[1m]')).toBe('instant')
    expect(modelName('gpt-5')).toBe('gpt-5')
    expect(modelName('')).toBe('—')
    expect(modelName(undefined)).toBe('—')
  })

  test('baseName takes the last segment of either slash', () => {
    expect(baseName('a/b\\c.ts')).toBe('c.ts')
    expect(baseName('dir/')).toBe('dir')
    expect(baseName('plain')).toBe('plain')
    expect(baseName('')).toBe('')
    expect(baseName('/')).toBe('/')
  })

  test('hash is FNV-1a 32-bit', () => {
    expect(hash('')).toBe(2166136261)
    expect(hash('a')).toBe(0xe40c292c)
    expect(hash('kozmos')).toBe(3033306776)
    expect(hash('kozmos')).toBe(hash('kozmos'))
    expect(hash('ğü')).not.toBe(hash('gu'))
  })

  test('noise is deterministic and in 0..1', () => {
    expect(noise(0, 0)).toBe(0)
    expect(noise(1, 2)).toBe(noise(1, 2))
    for (let i = 0; i < 20; i++) {
      const v = noise(i, i * 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('rng is a seeded mulberry32', () => {
    const r = rng(42)
    expect(r()).toBe(0.6011037519201636)
    expect(r()).toBe(0.44829055899754167)
    expect(r()).toBe(0.8524657934904099)
    expect(rng(-1)()).toBe(0.8964226141106337)
    expect(rng(0)()).toBe(0.26642920868471265)
    const a = rng(7)
    const b = rng(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('kz: text gauges', () => {
  test('bar fills with eighth blocks', () => {
    expect(bar(0.5, 10)).toBe('█████░░░░░')
    expect(bar(0.53, 10)).toBe('█████▎░░░░')
    expect(bar(0.0625, 2)).toBe('▏░')
    expect(bar(1, 4)).toBe('████')
    expect(bar(0, 3, '-')).toBe('---')
    expect(bar(-1, 3)).toBe('░░░')
    expect(bar(2, 0)).toBe('█')
    expect(bar(0.5, 3.9)).toBe('█▌░')
    expect(bar(0.5, NaN)).toBe('')
  })

  test('pips rounds to whole segments', () => {
    expect(pips(0.5, 6)).toBe('▰▰▰▱▱▱')
    expect(pips(1, 3, '#', '.')).toBe('###')
    expect(pips(-1, 2)).toBe('▱▱')
    expect(pips(0.3, 0)).toBe('▱')
    expect(pips(0.5, NaN)).toBe('')
  })

  test('sparkline scales to its own max or the given one', () => {
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7], 8)).toBe('▁▂▃▄▅▆▇█')
    expect(sparkline([9, 0, 1, 2, 3, 4, 5, 6, 7], 8)).toBe('▁▂▃▄▅▆▇█')
    expect(sparkline([1, 2], 5)).toBe('   ▅█')
    expect(sparkline([], 3)).toBe('   ')
    expect(sparkline([5, 10, 20], 2, 10)).toBe('██')
    expect(sparkline([-3, 1], 2)).toBe('▁█')
    // A NaN sample makes the scale NaN, so every cell falls back to the floor.
    expect(sparkline([NaN, -3, 1], 3)).toBe('▁▁▁')
    expect(sparkline([0, 0], 2)).toBe('▁▁')
  })

  test('brailleGraph draws two samples per cell, bottom up', () => {
    expect(brailleGraph([0, 1, 2, 3], 2, 1)).toEqual(['⣠⣾'])
    expect(brailleGraph([4, 4], 1, 2, 8)).toEqual(['⣀', '⣿'])
    expect(brailleGraph([1, 1, 1], 1, 2)).toEqual(['⣿', '⣿'])
    expect(brailleGraph([5], 2, 1)).toEqual(['⠀⢸'])
    expect(brailleGraph([], 2, 1)).toEqual(['⠀⠀'])
    expect(brailleGraph([0, 0], 1, 1)).toEqual(['⣀'])
    // Degenerate sizes: no columns, no rows, half a column.
    expect(brailleGraph([1], 0, 1)).toEqual([''])
    expect(brailleGraph([1], 2, 0)).toEqual([])
    expect(brailleGraph([1, 1, 1], 1.5, 1)).toEqual(['⣿⡇'])
  })
})

describe('kz: raster', () => {
  test('toBase64 matches the standard alphabet and padding', () => {
    expect(toBase64(new Uint8Array([]))).toBe('')
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==')
    expect(toBase64(new Uint8Array([77, 97]))).toBe('TWE=')
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
    expect(toBase64(new Uint8Array([255, 254, 253, 252]))).toBe('//79/A==')
    expect(toBase64(new Uint8Array([0, 0, 0, 251, 255]))).toBe('AAAA+/8=')
  })

  test('a new canvas is blank and clamps its size', () => {
    const c = new Canvas(2, 1)
    expect(c.cols).toBe(2)
    expect(c.rows).toBe(1)
    expect(c.encode()).toBe('IAAAAAAAAAEAAAABIAAAAAAAAAEAAAAB')
    expect(c.encode()).toBe(words(SP, D, D, SP, D, D))
    const tiny = new Canvas(0, -4)
    expect([tiny.cols, tiny.rows]).toEqual([1, 1])
    const huge = new Canvas(1000, 1000.7)
    expect([huge.cols, huge.rows]).toEqual([512, 256])
    const frac = new Canvas(3.9, 2.2)
    expect([frac.cols, frac.rows]).toEqual([3, 2])
  })

  test('set writes characters and colors, clipped to the canvas', () => {
    const c = new Canvas(2, 1)
    c.set(0, 0, 'A', '#ff0000', 0x00ff00)
    expect(c.encode()).toBe(words(0x41, 0xff0000, 0x00ff00, SP, D, D))
    c.set(1.7, 0.2, 'é', 0x123456, '#0000ff')
    expect(c.encode()).toBe(words(0x41, 0xff0000, 0x00ff00, 0xe9, 0x123456, 0x0000ff))
    // No colors: only the character changes.
    c.set(0, 0, 'B')
    expect(c.encode()).toBe(words(0x42, 0xff0000, 0x00ff00, 0xe9, 0x123456, 0x0000ff))
    // Out of bounds on every side: nothing changes.
    for (const [x, y] of [[-1, 0], [0, -1], [2, 0], [0, 1]] as const) c.set(x, y, 'Z', '#fff', '#fff')
    expect(c.encode()).toBe(words(0x42, 0xff0000, 0x00ff00, 0xe9, 0x123456, 0x0000ff))
    // Empty, astral and control characters become a space.
    c.set(0, 0, '')
    c.set(1, 0, '😀')
    expect(c.encode()).toBe(words(SP, 0xff0000, 0x00ff00, SP, 0x123456, 0x0000ff))
    c.set(0, 0, '\n')
    c.set(1, 0, '\u2580')
    expect(c.encode()).toBe(words(SP, 0xff0000, 0x00ff00, 0x2580, 0x123456, 0x0000ff))
  })

  test('text writes left to right and clips', () => {
    const c = new Canvas(3, 1)
    c.text(1, 0, 'ab😀z', '#010203')
    expect(c.encode()).toBe(words(SP, D, D, 0x61, 0x010203, D, 0x62, 0x010203, D))
    c.text(-1, 0, 'xy')
    expect(c.encode()).toBe(words(0x79, D, D, 0x61, 0x010203, D, 0x62, 0x010203, D))
  })

  test('paint sets a background only, clipped', () => {
    const c = new Canvas(2, 1)
    c.set(0, 0, 'Q', 0x111111)
    c.paint(0, 0, '#222222')
    c.paint(1.5, 0, 0x333333)
    c.paint(-1, 0, '#ffffff')
    c.paint(0, -1, '#ffffff')
    c.paint(2, 0, '#ffffff')
    c.paint(0, 1, '#ffffff')
    expect(c.encode()).toBe(words(0x51, 0x111111, 0x222222, SP, D, 0x333333))
  })

  test('pixel packs two half-cells per row with the upper-half block', () => {
    const c = new Canvas(2, 1)
    c.set(0, 0, 'x', 0x444444, 0x555555)
    c.pixel(0, 0, '#ff0000')
    expect(c.encode()).toBe(words(0x2580, 0xff0000, D, SP, D, D))
    c.pixel(0, 1, '#00ff00')
    expect(c.encode()).toBe(words(0x2580, 0xff0000, 0x00ff00, SP, D, D))
    c.pixel(1, 1.5, '#0000ff')
    expect(c.encode()).toBe(words(0x2580, 0xff0000, 0x00ff00, 0x2580, D, 0x0000ff))
    for (const [x, py] of [[-1, 0], [0, -1], [2, 0], [0, 2]] as const) c.pixel(x, py, '#ffffff')
    expect(c.encode()).toBe(words(0x2580, 0xff0000, 0x00ff00, 0x2580, D, 0x0000ff))
  })

  test('clear resets every cell, with an optional background', () => {
    const c = new Canvas(2, 1)
    c.text(0, 0, 'hi', '#ffffff', '#000001')
    c.clear(0x123456)
    expect(c.encode()).toBe(words(SP, D, 0x123456, SP, D, 0x123456))
    c.clear()
    expect(c.encode()).toBe(words(SP, D, D, SP, D, D))
  })
})

describe('kz: svg', () => {
  test('xml escapes the five special characters', () => {
    expect(xml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
    expect(xml('plain ğü')).toBe('plain ğü')
    expect(xml('')).toBe('')
  })

  test('svg wraps a body with the shared css', () => {
    expect(svg(10, 20, '<g/>', '.x{}')).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20"><style>${SVG_BASE_CSS}.x{}</style><g/></svg>`,
    )
    expect(svg(1, 2, '')).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2" viewBox="0 0 1 2"><style>${SVG_BASE_CSS}</style></svg>`)
    expect(SVG_BASE_CSS).toContain('prefers-color-scheme: dark')
  })

  test('textWidth weighs narrow, wide and normal characters', () => {
    expect(textWidth('', 10)).toBe(0)
    expect(textWidth('i', 10)).toBe(3)
    expect(textWidth('M', 10)).toBe(0.72 * 10)
    expect(textWidth('a', 10)).toBe(5.6000000000000005)
    expect(textWidth('Ab i', 10)).toBe(18.8)
  })

  test('fitText keeps what fits and ellipsizes the rest', () => {
    expect(fitText('hello', 12, 100)).toBe('hello')
    expect(fitText('hello world', 10, 30)).toBe('hello…')
    expect(fitText('W', 10, 1)).toBe('…')
    expect(fitText('', 10, 0)).toBe('')
  })

  test('svgBar draws a track and a fill at least as wide as it is tall', () => {
    expect(svgBar(0, 0, 100, 6, 0.5, '#f00')).toBe(
      '<rect class="k" x="0" y="0" width="100" height="6" rx="3"/><rect x="0" y="0" width="50" height="6" rx="3" fill="#f00"/>',
    )
    expect(svgBar(1, 2, 100, 6, 0, '#f00')).toBe('<rect class="k" x="1" y="2" width="100" height="6" rx="3"/>')
    expect(svgBar(0, 0, 100, 6, NaN, '#f00')).toBe('<rect class="k" x="0" y="0" width="100" height="6" rx="3"/>')
    expect(svgBar(0, 0, 100, 6, 0.01, '#0f0')).toBe(
      '<rect class="k" x="0" y="0" width="100" height="6" rx="3"/><rect x="0" y="0" width="6" height="6" rx="3" fill="#0f0"/>',
    )
    expect(svgBar(0, 0, 40, 4, 3, '#00f')).toBe(
      '<rect class="k" x="0" y="0" width="40" height="4" rx="2"/><rect x="0" y="0" width="40" height="4" rx="2" fill="#00f"/>',
    )
  })

  test('svgText escapes text and applies options', () => {
    expect(svgText(1, 2, 'a<b')).toBe(
      `<text class="t" x="1" y="2" font-family="${FONT}" font-size="12" font-weight="400" text-anchor="start" font-variant-numeric="tabular-nums">a&lt;b</text>`,
    )
    expect(svgText(1, 2, `x&'"`, { cls: 'm', size: 9, weight: 600, anchor: 'end', mono: true })).toBe(
      `<text class="m" x="1" y="2" font-family="${MONO}" font-size="9" font-weight="600" text-anchor="end" font-variant-numeric="tabular-nums">x&amp;&#39;&quot;</text>`,
    )
    expect(svgText(0, 0, 'z', { fill: '#fff', anchor: 'middle' })).toBe(
      `<text fill="#fff" x="0" y="0" font-family="${FONT}" font-size="12" font-weight="400" text-anchor="middle" font-variant-numeric="tabular-nums">z</text>`,
    )
  })

  test('pxOf converts columns to pixels within 200..1600', () => {
    expect(pxOf(undefined)).toBe(472)
    expect(pxOf(0)).toBe(472)
    expect(pxOf(100)).toBe(792)
    expect(pxOf(1000)).toBe(1600)
    expect(pxOf(10)).toBe(200)
    expect(pxOf(undefined, 40)).toBe(312)
    expect(pxOf(50, 60, 0)).toBe(400)
  })
})

describe('kz: prices and limits', () => {
  test('priceOf matches each family, newest first, with a default', () => {
    expect(priceOf('claude-fable-5')).toEqual([10, 50, 0.25, 12.5])
    expect(priceOf('claude-mythos-1')).toEqual([10, 50, 0.25, 12.5])
    expect(priceOf('claude-opus-5-5[1m]')).toEqual([4, 20, 0.2, 5])
    expect(priceOf('claude-opus-4-1')).toEqual([5, 25, 0.5, 6.25])
    expect(priceOf('claude-sonnet-5')).toEqual([2, 10, 0.2, 2.5])
    expect(priceOf('claude-sonnet-4-5')).toEqual([3, 15, 0.3, 3.75])
    expect(priceOf('claude-haiku-5')).toEqual([0.1, 0.5, 0.01, 0.125])
    expect(priceOf('claude-haiku-4-5')).toEqual([1, 5, 0.1, 1.25])
    expect(priceOf('gpt-5')).toEqual([4, 20, 0.2, 5])
    expect(priceOf('')).toEqual([4, 20, 0.2, 5])
  })

  test('costOf, tokensOf and contextOf sum the four kinds of tokens', () => {
    const full = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }
    expect(costOf('claude-opus-4-1', full)).toBe(36.75)
    expect(costOf('claude-sonnet-4', { output_tokens: 2000 })).toBe(0.03)
    expect(costOf('claude-sonnet-4', {})).toBe(0)
    expect(costOf('claude-sonnet-4', null)).toBe(0)
    expect(costOf('claude-sonnet-4', undefined)).toBe(0)
    expect(tokensOf(full)).toBe(4e6)
    expect(tokensOf({ input_tokens: 3 })).toBe(3)
    expect(tokensOf({})).toBe(0)
    expect(tokensOf(null)).toBe(0)
    expect(tokensOf(undefined)).toBe(0)
    expect(contextOf({ input_tokens: 5, cache_read_input_tokens: 7 })).toBe(12)
    expect(contextOf(null)).toBe(0)
  })

  test('windowOf is 200k for haiku 4 and 1M otherwise', () => {
    expect(windowOf('claude-haiku-4-5')).toBe(200_000)
    expect(windowOf('claude-opus-5-5')).toBe(1_000_000)
    expect(windowOf('')).toBe(1_000_000)
  })

  test('limitLabel, windowMs and untilReset', () => {
    expect(limitLabel('five_hour')).toBe('5h')
    expect(limitLabel('seven_day')).toBe('7d')
    expect(limitLabel('spend_limit')).toBe('$')
    expect(limitLabel('seven_day_opus')).toBe('seven day opus')
    expect(limitLabel('')).toBe('')
    expect(windowMs('five_hour')).toBe(18_000_000)
    expect(windowMs('seven_day')).toBe(604_800_000)
    expect(windowMs('spend_limit')).toBeUndefined()
    expect(untilReset({ kind: 'five_hour', percentUsed: 10 }, 0)).toBeUndefined()
    expect(untilReset({ kind: 'five_hour', percentUsed: 10, resetsAt: '' }, 0)).toBeUndefined()
    expect(untilReset({ kind: 'five_hour', percentUsed: 10, resetsAt: 'soon' }, 0)).toBeUndefined()
    expect(untilReset({ kind: 'five_hour', percentUsed: 10, resetsAt: '1970-01-01T00:00:10Z' }, 3000)).toBe(7000)
    expect(untilReset({ kind: 'five_hour', percentUsed: 10, resetsAt: '1970-01-01T00:00:10Z' }, 30_000)).toBe(0)
  })
})

describe('probe: platform and argv', () => {
  test('platformFrom reads OS, then uname', () => {
    expect(platformFrom('Windows_NT', undefined)).toBe('win')
    expect(platformFrom('windows_nt', 'Darwin')).toBe('win')
    expect(platformFrom(undefined, 'Darwin')).toBe('mac')
    expect(platformFrom('', 'Linux')).toBe('linux')
    expect(platformFrom(undefined, undefined)).toBe('linux')
  })

  test('argv lists are what the parsers expect', () => {
    expect(GIT_STATUS).toEqual(['git', 'status', '--porcelain=v2', '--branch', '--show-stash'])
    expect(GIT_HEAD).toEqual(['git', 'log', '-1', '--format=%h%x09%s%x09%cr'])
    expect(gitLogArgv(20)).toEqual(['git', 'log', '-20', '--format=%h%x09%s%x09%cr%x09%an%x09%ct'])
    expect(GIT_NUMSTAT).toEqual(['git', 'diff', '--numstat', 'HEAD'])
    expect(WIN_SYS[0]).toBe('powershell')
    expect(WIN_SYS[4]).toContain('ConvertTo-Json -Compress')
    expect(MAC_TOP).toEqual(['top', '-l', '1', '-n', '0'])
    expect(MAC_MEMSIZE).toEqual(['sysctl', '-n', 'hw.memsize'])
    expect(NVIDIA_SMI[0]).toBe('nvidia-smi')
  })
})

describe('probe: git', () => {
  test('parseGitStatus counts every kind of entry', () => {
    const status = [
      '# branch.oid 0123456789abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '# stash 3',
      '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
      '? new.txt',
      '? other.txt',
      '! ignored.log',
      '',
    ].join('\n')
    expect(parseGitStatus(status, 'abc1234\tFix the bug\t2 hours ago\n')).toEqual({
      isRepo: true,
      branch: 'main',
      isDetached: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      staged: 3,
      unstaged: 2,
      untracked: 2,
      conflicts: 1,
      head: { sha: 'abc1234', subject: 'Fix the bug', when: '2 hours ago' },
      stash: 3,
    })
  })

  test('parseGitStatus names a detached head by its sha', () => {
    const detached = '# branch.head (detached)\n'
    expect(parseGitStatus(detached, 'deadbee\tWIP\tnow')).toMatchObject({ isDetached: true, branch: 'deadbee' })
    expect(parseGitStatus(detached)).toMatchObject({ isDetached: true, branch: '(detached)' })
    expect(parseGitStatus(detached).head).toBeUndefined()
    expect(parseGitStatus('', 'cafe')).toMatchObject({ head: { sha: 'cafe', subject: '', when: '' } })
  })

  test('parseGitStatus survives empty and malformed output', () => {
    expect(parseGitStatus('')).toEqual({ ...NO_GIT, isRepo: true })
    expect(parseGitStatus('', '   \n')).toEqual({ ...NO_GIT, isRepo: true })
    const bad = parseGitStatus('# branch.ab garbage\n# stash x\r\n# branch.head  feat/ğü \r\nnonsense')
    expect(bad).toMatchObject({ ahead: 0, behind: 0, stash: 0, branch: 'feat/ğü', isDetached: false })
    expect(NO_GIT.isRepo).toBe(false)
  })

  test('parseGitLog reads commits and fills missing fields', () => {
    expect(parseGitLog('a1\tFirst\t2h ago\tAnn\t1700000000\n\nb2\n')).toEqual([
      { sha: 'a1', subject: 'First', when: '2h ago', author: 'Ann', at: 1_700_000_000_000 },
      { sha: 'b2', subject: '', when: '', author: '', at: 0 },
    ])
    expect(parseGitLog('c3\ts\tw\ta\tnope')[0]?.at).toBeNaN()
    expect(parseGitLog('')).toEqual([])
  })

  test('parseNumstat reads counts, binaries and tabbed paths', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\timg.png\n5\n\n2\t0\tweird\tname\n')).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'img.png', added: 0, removed: 0 },
      { path: '', added: 5, removed: 0 },
      { path: 'weird\tname', added: 2, removed: 0 },
    ])
    expect(parseNumstat('')).toEqual([])
  })
})

describe('probe: the machine', () => {
  test('parseWinSys reads the PowerShell JSON', () => {
    expect(parseWinSys('{"cpu":12,"free":4194304,"total":16777216,"dfree":100,"dsize":500,"procs":321}')).toEqual({
      cpu: 12, memTotal: 17_179_869_184, memUsed: 12_884_901_888, diskTotal: 500, diskUsed: 400, procs: 321,
    })
    expect(parseWinSys('{"cpu":null,"free":null,"total":10,"dfree":1}')).toEqual({})
    expect(parseWinSys('{"dsize":5,"free":3}')).toEqual({})
    expect(parseWinSys('{"cpu":"12"}')).toEqual({})
    expect(parseWinSys('')).toEqual({})
    expect(parseWinSys('not json')).toEqual({})
    expect(parseWinSys('null')).toEqual({})
  })

  test('parseProcStat measures busy time against the previous reading', () => {
    const first = parseProcStat('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4', undefined)
    expect(first).toEqual({ ticks: { idle: 800, total: 1000 } })
    const second = parseProcStat('cpu  200 0 200 1300 200 0 0 0 0 0', first.ticks)
    expect(second.ticks).toEqual({ idle: 1500, total: 1900 })
    expect(Math.round((second.cpu ?? 0) * 1000)).toBe(22_222)
    expect(parseProcStat('cpu  1 1 1 1 1', { idle: 0, total: 5 })).toEqual({ ticks: { idle: 2, total: 5 } })
    expect(parseProcStat('', { idle: 0, total: 0 })).toEqual({ ticks: { idle: 0, total: 0 } })
    expect(parseProcStat('cpu 1 x 2', undefined)).toEqual({ ticks: { idle: 0, total: 3 } })
  })

  test('parseMeminfo reads total and available', () => {
    expect(parseMeminfo('MemTotal:       16000 kB\nMemFree: 1 kB\nMemAvailable:    4000 kB\n')).toEqual({ memTotal: 16_384_000, memUsed: 12_288_000 })
    expect(parseMeminfo('MemTotal: 100 kB')).toEqual({ memTotal: 102_400, memUsed: 102_400 })
    expect(parseMeminfo('MemTotal: 0 kB')).toEqual({})
    expect(parseMeminfo('')).toEqual({})
  })

  test('parseMacTop reads cpu, used memory in G or M, and memsize', () => {
    expect(parseMacTop('CPU usage: 5.12% user, 3.4% sys, 91.48% idle\nPhysMem: 15G used (2G wired), 1G unused.', '17179869184\n')).toEqual({
      cpu: 8.52, memUsed: 16_106_127_360, memTotal: 17_179_869_184,
    })
    expect(parseMacTop('PhysMem: 512M used', '')).toEqual({ memUsed: 536_870_912 })
    expect(parseMacTop('', 'junk')).toEqual({})
    expect(parseMacTop('', '0')).toEqual({})
  })

  test('parseNvidia reads the first GPU and fills missing fields', () => {
    expect(parseNvidia('45, 1024, 8192, 61, NVIDIA GeForce RTX 4090\n10, 1, 2, 3, Other\n')).toEqual({
      util: 45, memUsed: 1_073_741_824, memTotal: 8_589_934_592, temp: 61, name: 'NVIDIA GeForce RTX 4090',
    })
    expect(parseNvidia('7')).toEqual({ util: 7, memUsed: 0, memTotal: 0, temp: 0, name: 'GPU' })
    expect(parseNvidia(', 5')).toEqual({ util: 0, memUsed: 5_242_880, memTotal: 0, temp: 0, name: 'GPU' })
    expect(parseNvidia('')).toBeUndefined()
    expect(parseNvidia('  \nignored')).toBeUndefined()
  })

  test('fmtBytes scales to K, M, G and T without rolling over to 1024 of a unit', () => {
    expect(fmtBytes(undefined)).toBe('—')
    expect(fmtBytes(NaN)).toBe('—')
    expect(fmtBytes(Infinity)).toBe('—')
    expect(fmtBytes(0)).toBe('0K')
    expect(fmtBytes(512)).toBe('1K')
    expect(fmtBytes(-100)).toBe('0K')
    expect(fmtBytes(1023.4 * 1024)).toBe('1023K')
    expect(fmtBytes(1024 ** 2 - 1)).toBe('1M')
    expect(fmtBytes(5 * 1024 ** 2)).toBe('5M')
    expect(fmtBytes(1023.4 * 1024 ** 2)).toBe('1023M')
    expect(fmtBytes(1024 ** 3 - 1)).toBe('1.0G')
    expect(fmtBytes(1.5 * 1024 ** 3)).toBe('1.5G')
    expect(fmtBytes(1023.94 * 1024 ** 3)).toBe('1023.9G')
    expect(fmtBytes(1024 ** 4 - 1)).toBe('1.0T')
    expect(fmtBytes(2 * 1024 ** 4)).toBe('2.0T')
  })
})

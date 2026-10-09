// Test helper: reads a painted Frame back as characters and colors.
import type { Frame } from '../hooks/timeline.ts'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesOf(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}

export type Cell = { ch: string; fg: string; bg: number }

/** Every cell of the frame, row by row; `fg` as '#rrggbb'. */
export function cellsOf(f: Frame): Cell[][] {
  const bytes = bytesOf(f.cells)
  const words = new Uint32Array(bytes.buffer, 0, f.columns * f.rows * 3)
  const rows: Cell[][] = []
  for (let y = 0; y < f.rows; y++) {
    const row: Cell[] = []
    for (let x = 0; x < f.columns; x++) {
      const i = (y * f.columns + x) * 3
      row.push({ ch: String.fromCodePoint(words[i] ?? 0x20), fg: `#${(words[i + 1] ?? 0).toString(16).padStart(6, '0')}`, bg: words[i + 2] ?? 0 })
    }
    rows.push(row)
  }
  return rows
}

/** The characters of row `y`. */
export function rowText(f: Frame, y: number): string {
  return (cellsOf(f)[y] ?? []).map(c => c.ch).join('')
}

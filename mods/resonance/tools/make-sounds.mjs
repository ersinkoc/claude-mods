// Synthesizes Resonance's sound set into ../sounds/*.wav.
// Run from anywhere with Node 22.18+ (type stripping on by default):
//   node mods/resonance/tools/make-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RATE, RECIPES, encodeWav, readWavHeader, renderRecipe } from './synth.ts'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds')
mkdirSync(out, { recursive: true })
for (const recipe of RECIPES) {
  const bytes = encodeWav(renderRecipe(recipe), RATE)
  const head = readWavHeader(bytes)
  writeFileSync(join(out, `${recipe.name}.wav`), bytes)
  console.log(`${recipe.name}.wav  ${(head.dataBytes / 2 / head.rate).toFixed(2)} s  ${bytes.length} bytes`)
}

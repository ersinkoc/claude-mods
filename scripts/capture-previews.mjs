// Captures what every mod draws, for the README.
//   node scripts/capture-previews.mjs [mod ...]
// For each mod: reads the components it draws from `claude plugin validate`,
// drops scripts/preview/kz-preview.test.tsx.tmpl into its tests/ for one run
// (a made-up rich session), collects the printed trees into
// docs/previews/_work/<mod>.json and removes the temporary test.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const tmpl = readFileSync(join(root, 'scripts', 'preview', 'kz-preview.test.tsx.tmpl'), 'utf8')
const out = join(root, 'docs', 'previews', '_work')
mkdirSync(out, { recursive: true })

const only = process.argv.slice(2)
const mods = readdirSync(join(root, 'mods')).filter(m => existsSync(join(root, 'mods', m, '.claude-plugin', 'plugin.json')) && (!only.length || only.includes(m)))

for (const mod of mods) {
  const v = spawnSync('claude', ['plugin', 'validate', `mods/${mod}`], { cwd: root, encoding: 'utf8', shell: isWin })
  const text = `${v.stdout}${v.stderr}`
  const sites = []
  for (const m of text.matchAll(/ui\.render\{component=([A-Za-z]+)(?:, requestId=([^,}]+))?[^}]*\}/g)) {
    if (!sites.some(s => s.component === m[1] && s.requestId === m[2])) sites.push(m[2] ? { component: m[1], requestId: m[2] } : { component: m[1] })
  }
  if (!sites.length) {
    console.log(`${mod}: draws nothing to capture`)
    writeFileSync(join(out, `${mod}.json`), '[]')
    continue
  }
  const file = join(root, 'mods', mod, 'tests', 'zz-kz-preview.test.tsx')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, tmpl.replace('__MOD__', mod).replace('__SITES__', JSON.stringify(sites)))
  try {
    const t = spawnSync('claude', ['plugin', 'test', `mods/${mod}`], { cwd: root, encoding: 'utf8', shell: isWin, maxBuffer: 256 * 1024 * 1024 })
    const all = `${t.stdout}${t.stderr}`
    const shots = all.split('\n').filter(l => l.startsWith('KZPREVIEW ')).map(l => JSON.parse(l.slice(10)))
    writeFileSync(join(out, `${mod}.json`), JSON.stringify(shots))
    const bad = shots.filter(s => s.error)
    console.log(`${mod}: ${shots.length - bad.length} drawings${bad.length ? `, ${bad.length} failed (${bad.map(b => `${b.surface}/${b.component}: ${b.error}`).join(' | ')})` : ''}${shots.length ? '' : `\n${all.split('\n').slice(-15).join('\n')}`}`)
  } finally {
    rmSync(file, { force: true })
  }
}

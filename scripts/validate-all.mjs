// Full bundle check: sync the shared kit, rebuild the catalog, type-check,
// then `claude plugin validate` and `claude plugin test` for every mod.
//   node scripts/validate-all.mjs [mod ...]
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: isWin })

execFileSync(process.execPath, [join(root, 'scripts', 'sync-shared.mjs')], { stdio: 'inherit' })
execFileSync(process.execPath, [join(root, 'scripts', 'build-catalog.mjs')], { stdio: 'inherit' })

const only = process.argv.slice(2)
const mods = readdirSync(join(root, 'mods')).filter(m => existsSync(join(root, 'mods', m, '.claude-plugin', 'plugin.json')) && (!only.length || only.includes(m)))

const tsc = run('npx', ['tsc', '-p', 'tsconfig.json'])
const tscOut = `${tsc.stdout}${tsc.stderr}`
const rows = []
for (const m of mods) {
  const typeErrors = tscOut.split('\n').filter(l => l.includes(`mods/${m}/`)).length
  const v = run('claude', ['plugin', 'validate', `mods/${m}`])
  const isValid = /Validation passed/.test(`${v.stdout}${v.stderr}`)
  const hasTests = existsSync(join(root, 'mods', m, 'tests'))
  const t = hasTests ? run('claude', ['plugin', 'test', `mods/${m}`]) : null
  const tOut = t ? `${t.stdout}${t.stderr}` : ''
  const pass = Number(/(\d+) pass/.exec(tOut)?.[1] ?? 0)
  const fail = Number(/(\d+) fail/.exec(tOut)?.[1] ?? 0)
  rows.push({ m, typeErrors, isValid, pass, fail, v: `${v.stdout}${v.stderr}`, t: tOut })
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${pad('mod', 13)}${pad('tsc', 8)}${pad('validate', 10)}tests`)
for (const r of rows) {
  console.log(`${pad(r.m, 13)}${pad(r.typeErrors ? `✖ ${r.typeErrors}` : '✔', 8)}${pad(r.isValid ? '✔' : '✖', 10)}${r.fail ? `✖ ${r.fail} failed, ${r.pass} passed` : r.pass ? `✔ ${r.pass}` : '—'}`)
}
const bad = rows.filter(r => r.typeErrors || !r.isValid || r.fail || !r.pass)
for (const r of bad) {
  console.log(`\n── ${r.m}`)
  if (r.typeErrors) console.log(tscOut.split('\n').filter(l => l.includes(`mods/${r.m}/`)).join('\n'))
  if (!r.isValid) console.log(r.v.split('\n').filter(l => /✘|error|❯ modules/.test(l)).join('\n'))
  if (r.fail || !r.pass) console.log(r.t.split('\n').slice(-25).join('\n'))
}
console.log(`\n${rows.length - bad.length}/${rows.length} mods clean`)
process.exit(bad.length ? 1 : 0)

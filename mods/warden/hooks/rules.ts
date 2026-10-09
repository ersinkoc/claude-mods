// KOZMOS warden: the risk classifier. Pure: no `$`, no engine calls, so the
// hook, its `.catch` handler and the tests can all run it on a command alone.
//
// Severity levels:
//   critical  wipes a disk, a home folder, a system path or a whole database:
//             rm -rf / ~ C:\ /usr, mkfs, format C:, dd to a device, DROP DATABASE
//   high      loses work or history, opens the machine, or runs code from the
//             network: git push --force, reset --hard, clean -fd, checkout -- .,
//             rm -rf . or *, DROP TABLE, TRUNCATE, chmod -R 777, curl | sh,
//             shutdown, del /s, your own extra patterns
//   medium    recoverable with some effort (the reflog keeps it):
//             git branch -D, git stash clear / drop
//
// Not flagged on purpose (look-alikes): rm -rf node_modules / dist / ./build/*
// and any other named path inside the project, rm -rf /tmp/x, deeper absolute
// paths, git push --force-with-lease, git reset --soft, git clean -n,
// git checkout -- one-file, git branch -d, chmod 777 one-file, and SQL words
// inside grep / echo / git commit messages.

export type Severity = 'critical' | 'high' | 'medium'

export type Hit = {
  /** A stable id of the rule (`rm`, `git-push-force`, ...). */
  rule: string
  /** What the band and the log say: `git push --force`, `rm -rf ~`. */
  label: string
  severity: Severity
  /** One plain sentence: why this is risky. */
  why: string
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1 }

export type Segment = {
  /** The words with quotes taken off. */
  words: string[]
  /** The segment as typed. */
  raw: string
  /** True when a `|` feeds this segment. */
  pipedFrom: boolean
  /** True when this segment's output is piped on. */
  pipesTo: boolean
}

// ---------------------------------------------------------------------------
// A small shell-ish splitter: good enough for bash, PowerShell and cmd lines.

export function splitSegments(cmd: string): Segment[] {
  const segs: Segment[] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let raw = ''
  let quote: '' | "'" | '"' = ''
  let pipedFrom = false
  let varBrace = 0

  const endWord = (): void => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSeg = (pipe: boolean): void => {
    endWord()
    if (words.length) segs.push({ words, raw: raw.trim(), pipedFrom, pipesTo: pipe })
    words = []
    raw = ''
    pipedFrom = pipe
  }

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i] ?? ''
    const n = cmd[i + 1] ?? ''
    if (quote) {
      raw += c
      if (c === quote) {
        quote = ''
        continue
      }
      if (quote === '"' && c === '\\' && (n === '"' || n === '\\' || n === '$' || n === '`')) {
        word += n
        raw += n
        i++
        continue
      }
      word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      hasWord = true
      raw += c
      continue
    }
    if (c === '\\' && (n === '"' || n === "'" || n === ' ' || n === '\n')) {
      if (n !== '\n') {
        word += n
        hasWord = true
      }
      raw += c + n
      i++
      continue
    }
    if (c === '`') {
      // PowerShell line continuation, else a bash command substitution edge.
      if (n === '\n' || n === '\r') {
        i++
        if (cmd[i + 1] === '\n') i++
        raw += ' '
        continue
      }
      endSeg(false)
      continue
    }
    if (c === '$' && n === '{') {
      varBrace++
      word += '${'
      hasWord = true
      raw += '${'
      i++
      continue
    }
    if (c === '}' && varBrace > 0) {
      varBrace--
      word += c
      raw += c
      continue
    }
    if (c === '$' && n === '(') {
      endSeg(false)
      i++
      continue
    }
    if (c === '(' || c === ')') {
      endSeg(false)
      continue
    }
    if ((c === '{' && !hasWord && /\s/.test(n)) || (c === '}' && !hasWord)) {
      endSeg(false)
      continue
    }
    if (c === ';' || c === '\n' || c === '\r') {
      endSeg(false)
      continue
    }
    if (c === '&') {
      const prev = cmd[i - 1] ?? ''
      if (prev === '>' || prev === '<' || n === '>') {
        word += c
        hasWord = true
        raw += c
        continue
      }
      if (n === '&') i++
      endSeg(false)
      continue
    }
    if (c === '|') {
      if (n === '|') {
        i++
        endSeg(false)
        continue
      }
      if (n === '&') i++
      endSeg(true)
      continue
    }
    if (/\s/.test(c)) {
      endWord()
      raw += c
      continue
    }
    word += c
    hasWord = true
    raw += c
  }
  endSeg(false)
  return segs
}

/** `C:\Tools\Git.EXE` → `git`. */
export function baseProg(w: string): string {
  const parts = w.split(/[\\/]/)
  return (parts[parts.length - 1] ?? w).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
}

const PREFIXES = new Set(['sudo', 'doas', 'nohup', 'time', 'env', 'command', 'exec', 'xargs', 'nice', 'ionice', 'builtin', 'then', 'do', 'else', '!', 'stdbuf', 'timeout', 'watch', 'call', 'start'])
const SUDO_VALUED = new Set(['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D'])

/** The program a segment runs and its arguments, past `VAR=x`, `sudo` and kin. */
export function programOf(words: readonly string[]): { prog: string; args: string[] } {
  let i = 0
  while (i < words.length) {
    const w = words[i] ?? ''
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++
      continue
    }
    const base = baseProg(w)
    if (PREFIXES.has(base) || w === '&' || w === '.') {
      i++
      while (i < words.length && (words[i] ?? '').startsWith('-')) {
        const flag = words[i] ?? ''
        i++
        if ((base === 'sudo' || base === 'doas') && SUDO_VALUED.has(flag)) i++
        if (base === 'xargs' && /^-[IdEsnLP]$/.test(flag)) i++
      }
      if (base === 'timeout' && /^\d/.test(words[i] ?? '')) i++
      continue
    }
    return { prog: base, args: words.slice(i + 1) }
  }
  return { prog: '', args: [] }
}

// ---------------------------------------------------------------------------
// How broad a path is.

export type Breadth = 'system' | 'here' | null

const SYSTEM_DIRS = /^\/(bin|boot|dev|etc|lib|lib32|lib64|opt|proc|root|sbin|srv|sys|usr|var|system|library|applications|volumes|private)(\/[^/]+)?$/i
const HOME = /^(~|\$home|\$\{home\}|%userprofile%|\$env:userprofile|\$env:home|\/home\/[^/]+|\/users\/[^/]+|[a-z]:\/users\/[^/]+)$/i

/** `system` for a root, drive, home or system path; `here` for `.`, `*`, `..`; else null. */
export function breadth(path: string): Breadth {
  let p = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (!p) return null
  if (p === '/' || /^\/(\*|\.)$/.test(p)) return 'system'
  // Trailing `/`, `/*`, `/.` say the same folder (or all of it).
  while (p.length > 1 && /(\/\*|\/\.|\/)$/.test(p)) p = p.replace(/(\/\*|\/\.|\/)$/, '')
  if (p === '' || p === '/') return 'system'
  if (/^[a-z]:$/i.test(p) || /^[a-z]:\/\*$/i.test(p)) return 'system'
  if (/^\/(mnt\/)?[a-z]$/i.test(p)) return 'system'
  if (/^[a-z]:\/(windows|program files|program files \(x86\)|programdata)(\/.*)?$/i.test(p)) return 'system'
  if (/^[a-z]:\/users$/i.test(p)) return 'system'
  if (HOME.test(p)) return 'system'
  // A top folder of a home: ~/Documents, ~/.ssh.
  const home = /^(.*)\/([^/]+)$/.exec(p)
  if (home && HOME.test(home[1] ?? '') && !/^(node_modules|\.cache|tmp|temp)$/i.test(home[2] ?? '')) return 'system'
  if (/^\/[^/]+$/.test(p) || /^[a-z]:\/[^/]+$/i.test(p)) return 'system'
  if (SYSTEM_DIRS.test(p)) return 'system'
  // An unset variable turns `$DIR/` into `/`.
  if (/^\$(\{\w+\}|\w+|env:\w+)$/i.test(p) && /\/\*?$/.test(path.trim().replace(/\\/g, '/'))) return 'system'
  if (p === '.' || p === '..' || p === '*' || p === '.*' || /^(\.\.\/)+\.\.$/.test(p) || /^\.\/\.\.?$/.test(p)) return 'here'
  return null
}

// ---------------------------------------------------------------------------
// The rules.

const TEXT_TOOLS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'echo', 'printf', 'cat', 'less', 'more', 'head', 'tail', 'sed', 'awk',
  'git', 'select-string', 'sls', 'findstr', 'write-host', 'write-output', 'write-error', 'man', 'diff', 'code', 'vim',
  'nano', 'type', 'gc', 'get-content', 'truncate', 'jq', 'tee', 'claude', 'gh',
])
const DB_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'clickhouse-client', 'cockroach', 'duckdb', 'mongosh', 'pgcli', 'mycli'])
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'fetch', 'http', 'aria2c'])
const RUNNERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'iex', 'invoke-expression', 'python', 'python3', 'node', 'perl', 'ruby', 'pwsh', 'powershell', 'cmd'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const REMOVERS_PS = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir'])

const hit = (rule: string, label: string, severity: Severity, why: string): Hit => ({ rule, label, severity, why })

function shortFlags(args: readonly string[]): string {
  return args.filter(a => /^-[A-Za-z]+$/.test(a)).map(a => a.slice(1)).join('')
}

function clipLabel(s: string): string {
  return s.length > 48 ? s.slice(0, 47) + '…' : s
}

function rmHits(args: readonly string[]): Hit[] {
  let isRecursive = false
  let isForce = false
  const targets: string[] = []
  let isEnd = false
  for (const a of args) {
    if (!isEnd && a === '--') {
      isEnd = true
      continue
    }
    if (!isEnd && a.startsWith('--')) {
      if (a === '--recursive') isRecursive = true
      if (a === '--force') isForce = true
      continue
    }
    if (!isEnd && /^-[A-Za-z]+$/.test(a)) {
      if (/[rR]/.test(a)) isRecursive = true
      if (/f/.test(a)) isForce = true
      continue
    }
    targets.push(a)
  }
  if (!isRecursive) return []
  const flag = `-r${isForce ? 'f' : ''}`
  return rankedTargets(targets).map(([t, b]) =>
    b === 'system'
      ? hit('rm', clipLabel(`rm ${flag} ${t}`), 'critical', 'Deletes a root, drive, home or system folder and everything in it.')
      : hit('rm-here', clipLabel(`rm ${flag} ${t}`), 'high', 'Deletes everything in the working folder.'),
  )
}

function rankedTargets(targets: readonly string[]): [string, Breadth][] {
  const out: [string, Breadth][] = []
  for (const t of targets.flatMap(x => x.split(','))) {
    const b = breadth(t)
    if (b) out.push([t, b])
  }
  return out.sort((a, b) => (a[1] === b[1] ? 0 : a[1] === 'system' ? -1 : 1)).slice(0, 1)
}

function removeItemHits(prog: string, args: readonly string[]): Hit[] {
  let isRecursive = false
  let isForce = false
  const targets: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (/^\/s$/i.test(a)) {
      isRecursive = true
      continue
    }
    if (/^\/q$/i.test(a)) {
      isForce = true
      continue
    }
    if (a.startsWith('-')) {
      const name = a.toLowerCase().replace(/:.*$/, '')
      if (/^-r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(name)) isRecursive = true
      else if (/^-fo(r(c(e)?)?)?$/.test(name) || name === '-f') isForce = true
      else if (/^-(path|literalpath|pspath|lp)$/.test(name)) {
        const v = args[i + 1]
        if (v !== undefined) targets.push(v)
        i++
      } else if (/^-(include|exclude|filter|credential|stream)$/.test(name)) i++
      continue
    }
    targets.push(a)
  }
  const isCmdDel = prog === 'del' || prog === 'erase'
  if (!isRecursive) return []
  const shown = isCmdDel ? `${prog} /s` : `Remove-Item -Recurse${isForce ? ' -Force' : ''}`
  const broad = rankedTargets(targets)
  const first = broad[0]
  if (first) {
    return [first[1] === 'system'
      ? hit('remove-item', clipLabel(`${shown} ${first[0]}`), 'critical', 'Deletes a root, drive, home or system folder and everything in it.')
      : hit('remove-item-here', clipLabel(`${shown} ${first[0]}`), 'high', 'Deletes everything in the working folder.')]
  }
  // `del /s` deletes matching files through every subfolder, wherever it points.
  if (isCmdDel) return [hit('del-s', clipLabel(`${shown} ${targets.join(' ')}`.trim()), 'high', 'Deletes matching files in every subfolder, with no recycle bin.')]
  return []
}

function gitHits(args: readonly string[]): Hit[] {
  let i = 0
  while (i < args.length) {
    const a = args[i] ?? ''
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') {
      i += 2
      continue
    }
    if (a.startsWith('-')) {
      i++
      continue
    }
    break
  }
  const sub = (args[i] ?? '').toLowerCase()
  const rest = args.slice(i + 1)
  const flags = rest.filter(a => a.startsWith('-'))
  const positional = rest.filter(a => !a.startsWith('-'))
  const short = shortFlags(rest)
  switch (sub) {
    case 'push': {
      const isForce = flags.includes('--force') || short.includes('f') || positional.some(p => p.startsWith('+'))
      return isForce ? [hit('git-push-force', 'git push --force', 'high', 'Overwrites the remote branch: commits others pushed can vanish. --force-with-lease is the safe form.')] : []
    }
    case 'reset':
      return flags.includes('--hard') ? [hit('git-reset-hard', 'git reset --hard', 'high', 'Throws away every uncommitted change in the working tree.')] : []
    case 'clean': {
      const isForce = flags.includes('--force') || short.includes('f')
      const isDry = flags.includes('--dry-run') || short.includes('n')
      if (!isForce || isDry) return []
      const label = `git clean -f${short.includes('d') ? 'd' : ''}${short.includes('x') || short.includes('X') ? 'x' : ''}`
      return [hit('git-clean', label, 'high', 'Deletes untracked files for good; git cannot bring them back.')]
    }
    case 'checkout': {
      if (positional.some(p => p === '.' || p === ':/' || p === '*')) return [hit('git-checkout-dot', 'git checkout -- .', 'high', 'Discards every unstaged change in the tree.')]
      if (flags.includes('--force') || /^f+$/.test(short) && short.length > 0) return [hit('git-checkout-force', 'git checkout -f', 'high', 'Switches branch and discards local changes.')]
      return []
    }
    case 'restore': {
      const isStagedOnly = flags.includes('--staged') && !flags.includes('--worktree') && !short.includes('W')
      if (!isStagedOnly && positional.some(p => p === '.' || p === ':/' || p === '*')) return [hit('git-restore-dot', 'git restore .', 'high', 'Discards every unstaged change in the tree.')]
      return []
    }
    case 'branch': {
      const isForceDelete = flags.includes('-D') || ((flags.includes('--delete') || short.includes('d')) && (flags.includes('--force') || short.includes('f')))
      return isForceDelete ? [hit('git-branch-D', 'git branch -D', 'medium', 'Deletes a branch even when it is not merged; only the reflog remembers it.')] : []
    }
    case 'stash': {
      const what = (positional[0] ?? '').toLowerCase()
      if (what === 'clear') return [hit('git-stash-clear', 'git stash clear', 'medium', 'Drops every stash at once.')]
      if (what === 'drop') return [hit('git-stash-drop', 'git stash drop', 'medium', 'Drops a stash; only its dangling commit remains.')]
      return []
    }
    default:
      return []
  }
}

function sqlHits(text: string): Hit[] {
  const out: Hit[] = []
  if (/\bdrop\s+(database|schema)\b/i.test(text)) out.push(hit('sql-drop-db', 'DROP DATABASE', 'critical', 'Drops a whole database.'))
  if (/\bdrop\s+table\b/i.test(text)) out.push(hit('sql-drop-table', 'DROP TABLE', 'high', 'Drops a table and all its rows.'))
  if (/\btruncate\s+(table\s+)?[`"[\w]/i.test(text)) out.push(hit('sql-truncate', 'TRUNCATE', 'high', 'Empties a table, with no undo.'))
  return out
}

function segmentHits(seg: Segment, next: Segment | undefined, depth: number, extra: readonly RegExp[]): Hit[] {
  const { prog, args } = programOf(seg.words)
  if (!prog) return []
  const out: Hit[] = []
  const lower = args.map(a => a.toLowerCase())

  // A shell inside the shell: judge what it runs.
  if (depth < 3) {
    if (SHELLS.has(prog)) {
      const at = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
      const inner = at >= 0 ? args[at + 1] : undefined
      if (inner) out.push(...scan(inner, extra, depth + 1))
    }
    if (prog === 'pwsh' || prog === 'powershell') {
      const at = lower.findIndex(a => /^-(c|command)$/.test(a))
      if (at >= 0) out.push(...scan(args.slice(at + 1).join(' '), extra, depth + 1))
    }
    if (prog === 'cmd') {
      const at = lower.findIndex(a => a === '/c' || a === '/k')
      if (at >= 0) out.push(...scan(args.slice(at + 1).join(' '), extra, depth + 1))
    }
    if (prog === 'eval' || prog === 'invoke-expression' || prog === 'iex') {
      if (args.length && !seg.pipedFrom) out.push(...scan(args.join(' '), extra, depth + 1))
    }
  }

  if (prog === 'rm') {
    // In PowerShell `rm` is Remove-Item: `-r -fo` read the same as `-rf` here,
    // and `-Path X` / `-Recurse` spelled out go through Remove-Item's reading.
    const asRm = rmHits(args)
    out.push(...(asRm.length ? asRm : removeItemHits('remove-item', args)))
  }
  if (REMOVERS_PS.has(prog)) out.push(...removeItemHits(prog, args))
  if (prog === 'git') out.push(...gitHits(args))

  if (!TEXT_TOOLS.has(prog)) out.push(...sqlHits(seg.raw))
  else if (seg.pipesTo && next && DB_CLIENTS.has(programOf(next.words).prog)) out.push(...sqlHits(seg.raw))

  if (/^mkfs(\..+)?$/.test(prog) || prog === 'mke2fs' || prog === 'wipefs') out.push(hit('mkfs', prog, 'critical', 'Formats a disk or partition: everything on it is gone.'))
  if (prog === 'dd' && lower.some(a => /^of=\/dev\/(sd|hd|nvme|disk|rdisk|mmcblk|xvd|vd)/.test(a))) out.push(hit('dd-device', 'dd of=/dev/…', 'critical', 'Writes raw bytes over a disk.'))
  if (prog === 'format' && args.some(a => /^[a-z]:\\?$/i.test(a))) out.push(hit('format', clipLabel(`format ${args.find(a => /^[a-z]:/i.test(a)) ?? ''}`), 'critical', 'Formats a drive: everything on it is gone.'))
  if (prog === 'format-volume' || prog === 'clear-disk' || prog === 'initialize-disk') out.push(hit('format', prog === 'clear-disk' ? 'Clear-Disk' : prog === 'initialize-disk' ? 'Initialize-Disk' : 'Format-Volume', 'critical', 'Formats or wipes a disk.'))
  if (prog === 'diskpart') out.push(hit('diskpart', 'diskpart', 'high', 'Edits disk partitions.'))

  const isShutdown = ['shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer'].includes(prog)
  const isCancel = lower.some(a => a === '-c' || a === '/a' || a === '-a' || a === '/?' || a === '--help')
  if (isShutdown && !isCancel) out.push(hit('shutdown', prog === 'stop-computer' ? 'Stop-Computer' : prog === 'restart-computer' ? 'Restart-Computer' : prog, 'high', 'Turns the machine off or restarts it mid-session.'))
  if (prog === 'systemctl' && lower.some(a => ['poweroff', 'reboot', 'halt', 'kexec'].includes(a))) out.push(hit('shutdown', `systemctl ${lower.find(a => ['poweroff', 'reboot', 'halt', 'kexec'].includes(a))}`, 'high', 'Turns the machine off or restarts it mid-session.'))
  if (prog === 'init' && (lower[0] === '0' || lower[0] === '6')) out.push(hit('shutdown', `init ${lower[0]}`, 'high', 'Turns the machine off or restarts it mid-session.'))

  if (prog === 'chmod') {
    const isRecursive = lower.includes('--recursive') || /R/.test(shortFlags(args))
    const isOpen = lower.some(a => /^(0?777|a\+rwx|ugo\+rwx|\+rwx|a=rwx|ugo=rwx)$/.test(a))
    if (isRecursive && isOpen) {
      const broad = rankedTargets(args.filter(a => !a.startsWith('-') && !/^(0?777|[augo]*[+=]rwx)$/i.test(a)))
      out.push(hit('chmod-777', 'chmod -R 777', broad[0]?.[1] === 'system' ? 'critical' : 'high', 'Makes every file writable and runnable by every user.'))
    }
  }

  if (DOWNLOADERS.has(prog) && seg.pipesTo && next && RUNNERS.has(programOf(next.words).prog)) {
    out.push(hit('curl-sh', `${prog} | ${programOf(next.words).prog}`, 'high', 'Runs a script straight from the network, unread.'))
  }
  return out
}

const RAW_RULES: readonly [RegExp, Hit][] = [
  [/\b(ba|z|da|k)?sh\s+<\(\s*(curl|wget)\b/i, hit('curl-sh', 'sh <(curl …)', 'high', 'Runs a script straight from the network, unread.')],
  [/\b(iex|invoke-expression)\b[\s(&]+.*\b(irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b/i, hit('curl-sh', 'iex (irm …)', 'high', 'Runs a script straight from the network, unread.')],
  [/\b(ba|z)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/i, hit('curl-sh', 'sh -c "$(curl …)"', 'high', 'Runs a script straight from the network, unread.')],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, hit('fork-bomb', 'fork bomb', 'high', 'Spawns processes until the machine stalls.')],
]

function scan(command: string, extra: readonly RegExp[], depth: number): Hit[] {
  const out: Hit[] = []
  const segs = splitSegments(command)
  segs.forEach((seg, i) => out.push(...segmentHits(seg, segs[i + 1], depth, extra)))
  if (depth === 0) {
    for (const [re, h] of RAW_RULES) if (re.test(command)) out.push(h)
    for (const re of extra) {
      re.lastIndex = 0
      if (re.test(command)) out.push(hit('custom', clipLabel(`custom /${re.source}/`), 'high', 'Matches one of your own warden patterns.'))
    }
  }
  return out
}

/** Every rule a command trips, the most severe first. */
export function classifyAll(command: string, extra: readonly RegExp[] = []): Hit[] {
  if (!command || !command.trim()) return []
  const seen = new Set<string>()
  return scan(command, extra, 0)
    .filter(h => {
      const k = `${h.rule}|${h.label}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/** The most severe rule a command trips, or null when it looks safe. */
export function classify(command: string, extra: readonly RegExp[] = []): Hit | null {
  return classifyAll(command, extra)[0] ?? null
}

/** `extraPatterns`: regexes separated by `;;`. Bad ones are skipped (and reported). */
export function parseExtra(src: string | undefined): { patterns: RegExp[]; bad: string[] } {
  const patterns: RegExp[] = []
  const bad: string[] = []
  for (const part of String(src ?? '').split(';;')) {
    const p = part.trim()
    if (!p) continue
    try {
      patterns.push(new RegExp(p, 'i'))
    } catch {
      bad.push(p)
    }
  }
  return { patterns, bad }
}

/** The rule book, for /warden. */
export const RULE_BOOK: readonly [Severity, string][] = [
  ['critical', 'rm -r / Remove-Item -Recurse / rd /s on /, ~, C:\\, a home or a system folder'],
  ['critical', 'mkfs, wipefs, dd of=/dev/…, format C:, Format-Volume, Clear-Disk'],
  ['critical', 'DROP DATABASE / DROP SCHEMA'],
  ['high', 'rm -rf . or * or .. (the whole working folder)'],
  ['high', 'git push --force / -f / +ref (not --force-with-lease)'],
  ['high', 'git reset --hard · git clean -f[d] · git checkout -- . · git restore .'],
  ['high', 'DROP TABLE · TRUNCATE (not inside grep, echo or a commit message)'],
  ['high', 'del /s · shutdown / reboot / Stop-Computer · chmod -R 777'],
  ['high', 'curl | sh, wget | bash, iex (irm …), sh <(curl …) · fork bomb'],
  ['high', 'your extraPatterns'],
  ['medium', 'git branch -D · git stash clear / drop'],
]

# KOZMOS

**48 live, visual mods for Claude Code — in the terminal and in the desktop app.**

Above the chat input, in the sidebar, in the transcript, on the status line and in
your speakers: what Claude is doing right now, what it costs, how close you are to
the 5-hour and weekly limits, what your subagents are up to, how full the context
is, the state of your git tree and the heat of your machine.

<p align="center">
  <a href="docs/media/kozmos-promo.mp4"><img src="docs/media/kozmos-promo-poster.jpg" alt="KOZMOS: the 2:48 promo film. Click to watch." width="860"></a>
  <br><sub>▶ <a href="docs/media/kozmos-promo.mp4">Watch the 2:48 film</a> (1080p, with sound)</sub>
</p>

<p align="center">
  <img src="docs/previews/orrery-aboveprompt-terminal.png" alt="orrery: subagents orbiting Claude above the prompt" width="860">
</p>
<table><tr>
<td valign="top"><img src="docs/previews/bridge-pane-terminal.png" alt="bridge sidebar in the terminal" width="560"></td>
<td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/bridge-pane-desktop-dark.png"><img src="docs/previews/bridge-pane-desktop-light.png" alt="bridge sidebar in the desktop app" width="270"></picture></td>
</tr></table>

KOZMOS is a bundle of independent **function-hooks plugins** ("mods"). Install one,
a preset, or all of them. Every mod draws twice: for the **terminal** (colored text,
cell rasters, 30 fps surface animations) and for the **desktop app** (animated SVG
that follows the light and dark themes).

> Requires Claude Code **2.1.290+**, where function hooks are on by default.
> The mod API is early access and may change between releases.

## Install

### Inside Claude Code

```
/plugin marketplace add ersinkoc/claude-mods
/plugin install kozmos@kozmos
/plugin install bridge@kozmos
```

or one line per mod: `/plugin install orrery --marketplace ersinkoc/claude-mods`.
Then type **`/kozmos`**: the hub lists every mod and opens each one with a click.

### With the installer: a menu, presets, uninstall

```bash
git clone https://github.com/ersinkoc/claude-mods.git
cd claude-mods
```

```powershell
./install.ps1                    # Windows: interactive menu
./install.ps1 -Preset showtime   # essentials | showtime | all
./install.ps1 -Mods bridge,orrery,halo
./install.ps1 -Uninstall
```

```bash
./install.sh                     # macOS / Linux / Git Bash
./install.sh --preset all
```

The installer adds the folder as the `kozmos` marketplace and installs what you
pick at the user scope, so the mods load in the CLI and in the desktop app's Code
tab. A folder marketplace is read from the folder itself: after `git pull`,
`/reload-plugins` picks up the new code. To try one mod for a single session:
`claude --plugin-dir mods/bridge`.

### Presets

- **essentials** — kozmos, bridge, halo, questline, marquee, hivemind, hourglass, compass, stamp, warden, ballast
- **showtime** — essentials + heartline, orrery, glyphfall, aurora, throttle, clawdling, skies, laurels, warpdrive, tidewater, storyboard, mantra, verdict
- **all** — everything

---

## ⚡ Sponsored by WrongStack

<div align="center">

### _Built on the wrong stack. Shipped anyway._

**Want way more than Claude Code?** **[WrongStack](https://wrongstack.com)** is a free, [open-source](https://github.com/WrongStack/WrongStack) AI coding agent with a Brain, a Memory, and a full toolbox. It reads your code, edits files, runs commands, and coordinates specialist agents — across six surfaces, from a plain terminal REPL to a cross-machine HQ dashboard. No subscription required, and you keep your hand on every permission.

[![Website](https://img.shields.io/badge/%F0%9F%8C%90_Website-wrongstack.com-6E56CF?style=for-the-badge)](https://wrongstack.com)
&nbsp;
[![GitHub](https://img.shields.io/badge/GitHub-WrongStack%2FWrongStack-181717?style=for-the-badge&logo=github)](https://github.com/WrongStack/WrongStack)
&nbsp;
[![Stars](https://img.shields.io/github/stars/WrongStack/WrongStack?style=for-the-badge&color=e3b341&logo=github)](https://github.com/WrongStack/WrongStack/stargazers)

```bash
curl -fsSL https://wrongstack.com/install.sh | sh   # macOS / Linux — self-contained binary
```

```powershell
irm https://wrongstack.com/install.ps1 | iex        # Windows (PowerShell) — no Node.js needed
```

</div>

| | What you get |
|---|---|
| 🌐 **[200+ LLM providers](https://wrongstack.com)** | Catalog pulled live from models.dev — Anthropic, OpenAI, Google, plus OAuth sign-in for Claude Pro/Max, ChatGPT and Copilot, and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio) |
| 🛠️ **[67 built-in tools](https://github.com/WrongStack/WrongStack)** | Edits, lint/typecheck/test, execution, git, web, browser/E2E and a SQLite codebase index — every call gated by per-tool permissions |
| 🧠 **[SAGE memory](https://github.com/WrongStack/WrongStack/blob/main/docs/sage/ARCHITECTURE.md)** | Project-wide long-term memory in SQLite/FTS5, anchored to files, symbols and commits — it gets better at *your* codebase over time |
| 🖥️ **[Six surfaces](https://wrongstack.com)** | Readline REPL · Ink/React TUI (`--tui`) · WebUI · SimpleUI · Desktop · cross-machine HQ (`--hq`) |
| 🤖 **[Fleet orchestration](https://github.com/WrongStack/WrongStack/blob/main/docs/director-architecture.md)** | A Director fans out specialist subagents over a project mailbox; `eternal` & `parallel` goal loops run until the contract verifies |
| 🔍 **[Chimera & Kanban](https://wrongstack.com)** | Auto-review agents that critique your diffs with severity-ranked findings, plus durable Kanban boards with atomic verification |
| 🔐 **[Secure by default](https://github.com/WrongStack/WrongStack/blob/main/SECURITY.md)** | Encrypted secrets at rest, project-root containment, opt-in YOLO mode — MIT licensed, TypeScript-strict |

> **📊 The perfect pairing:** KOZMOS's **hourglass**, **bridge** and **throttle** tell you exactly where your Claude limits stand — and **WrongStack** keeps you moving when they close in. It reads plan windows for Claude, ChatGPT, Copilot, Z.AI and more right in its own statusline and quota page, and when one provider runs dry, **fallback chains** rotate you onto the next model automatically. Watch the gauges, dodge the wall.

<div align="center">

🔗 **[wrongstack.com](https://wrongstack.com)** &nbsp;·&nbsp; **[github.com/WrongStack/WrongStack](https://github.com/WrongStack/WrongStack)** &nbsp;·&nbsp; ⭐ **[Star it on GitHub](https://github.com/WrongStack/WrongStack/stargazers)**

</div>

---

## The mods

The pictures are the mods' own drawings, played through a made-up session in
`claude plugin test` and rendered by `scripts/render-previews.mjs`.

<!-- gallery:start -->
<!-- Generated by scripts/build-readme.mjs. Edit the mods' plugin.json descriptions instead. -->

### Hub

One command opens them all.

#### Kozmos · `/kozmos`

the launcher for the whole bundle. /kozmos opens a starfield sidebar listing every KOZMOS mod by where it draws, which ones are installed in this session, and a button that runs each mod's own command.

<table><tr><td valign="top"><img src="docs/previews/kozmos-pane-terminal.png" alt="kozmos in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/kozmos-pane-desktop-dark.png"><img src="docs/previews/kozmos-pane-desktop-light.png" alt="kozmos in the desktop app" width="300"></picture></td></tr></table>


### Sidebars

Docked beside the transcript; each toggles with its own command.

#### Almanac · `/almanac`

what this session is made of. Slash commands run, skills invoked, subagent types spawned, MCP servers used, models seen, plugins whose tools were called and tool families, each with counts and first-use time, as ranked bars and tag clouds; plus the engine version and how many installed commands went unused. /almanac toggles it.

<table><tr><td valign="top"><img src="docs/previews/almanac-pane-terminal.png" alt="almanac in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/almanac-pane-desktop-dark.png"><img src="docs/previews/almanac-pane-desktop-light.png" alt="almanac in the desktop app" width="300"></picture></td></tr></table>

#### Breadcrumbs · `/breadcrumbs`

the session's web trail in a sidebar. WebSearch queries with result counts and top hits, WebFetch URLs with status and size, and browser-like MCP visits, grouped by domain with a monogram badge, clickable links and a copy-all-as-Markdown button. /breadcrumbs toggles it.

<table><tr><td valign="top"><img src="docs/previews/breadcrumbs-pane-terminal.png" alt="breadcrumbs in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/breadcrumbs-pane-desktop-dark.png"><img src="docs/previews/breadcrumbs-pane-desktop-light.png" alt="breadcrumbs in the desktop app" width="300"></picture></td></tr></table>

#### Bridge · `/bridge`

a mission-control sidebar. Model and effort, context fill, 5-hour and weekly limits with reset countdowns, session cost and burn rate, git branch and tree state, CPU/RAM/GPU, live subagents and the tool running now. /bridge toggles it.

<table><tr><td valign="top"><img src="docs/previews/bridge-pane-terminal.png" alt="bridge in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/bridge-pane-desktop-dark.png"><img src="docs/previews/bridge-pane-desktop-light.png" alt="bridge in the desktop app" width="300"></picture></td></tr></table>

#### Chronicle · `/chronicle`

the session as a timeline. Prompts, turn ends with duration, tool count and spend, subagents spawned and finished, commits and pushes, failed tools, compactions, and rate-limit and context milestones, each stamped HH:MM:SS, newest first, with filters. /chronicle toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/chronicle-pane-terminal.png" alt="chronicle in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/chronicle-pane-desktop-dark.png"><img src="docs/previews/chronicle-pane-desktop-light.png" alt="chronicle in the desktop app" width="300"></picture></td></tr></table>

#### Faultline · `/faultline`

the error lens in a sidebar. Every failed or denied tool call, refused or errored turn and API error, grouped by a masked signature with count, first and last seen, the agents that hit it, the full first error (expandable) and a copy button, under a severity strip of the last 10 minutes. /faultline toggles it.

<table><tr><td valign="top"><img src="docs/previews/faultline-pane-terminal.png" alt="faultline in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/faultline-pane-desktop-dark.png"><img src="docs/previews/faultline-pane-desktop-light.png" alt="faultline in the desktop app" width="300"></picture></td></tr></table>

#### Gearbox · `/gearbox`

tool analytics for the session. Per tool its calls, errors and error rate, average, p95 and max duration and total time as a sorted bar chart, the five slowest calls, calls per minute, and the main loop against subagents. /gearbox toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/gearbox-pane-terminal.png" alt="gearbox in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/gearbox-pane-desktop-dark.png"><img src="docs/previews/gearbox-pane-desktop-light.png" alt="gearbox in the desktop app" width="300"></picture></td></tr></table>

#### Gitscope · `/gitscope`

a git radar sidebar. Branch, upstream and ahead/behind, staged/changed/new/conflict counts and stashes, the last 8 commits on a graph rail, per-file +/- histograms from git diff, and a marker on every file this session edited. /gitscope toggles it.

<table><tr><td valign="top"><img src="docs/previews/gitscope-pane-terminal.png" alt="gitscope in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/gitscope-pane-desktop-dark.png"><img src="docs/previews/gitscope-pane-desktop-light.png" alt="gitscope in the desktop app" width="300"></picture></td></tr></table>

#### Hivemind · `/hivemind`

the agent swarm as a live tree. The main loop at the root and every subagent beneath its parent, each with a status glyph, type and task, model and effort, elapsed time, requests, tokens, estimated spend, context fill and the tool it runs now. /hivemind toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/hivemind-pane-terminal.png" alt="hivemind in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/hivemind-pane-desktop-dark.png"><img src="docs/previews/hivemind-pane-desktop-light.png" alt="hivemind in the desktop app" width="300"></picture></td></tr></table>

#### Hourglass · `/hourglass`

the limit oracle. For the 5-hour, weekly and spend windows: percent used, reset countdown, a burn rate learned across sessions, the time to 100 % and a verdict on whether the reset comes first. Toasts at 80 % and 95 %, an optional status line. /hourglass toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/hourglass-pane-terminal.png" alt="hourglass in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/hourglass-pane-desktop-dark.png"><img src="docs/previews/hourglass-pane-desktop-light.png" alt="hourglass in the desktop app" width="300"></picture></td></tr></table>

#### Launchpad · `/launchpad`

a pane of big launch buttons. It learns your most-used slash commands as you run them, keeps pinned favorites and saved prompts, and runs a command or fills the prompt box in one press. /launchpad toggles it; save <text>, rm <n>, pin <cmd>, unpin <cmd>, list.

<table><tr><td valign="top"><img src="docs/previews/launchpad-pane-terminal.png" alt="launchpad in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/launchpad-pane-desktop-dark.png"><img src="docs/previews/launchpad-pane-desktop-light.png" alt="launchpad in the desktop app" width="300"></picture></td></tr></table>

#### Mosaic · `/mosaic`

a GitHub-style activity calendar across sessions. 26 weeks of days colored by turns, tool calls, tokens or dollars, with the current and longest streak, the best day, totals and today's line. /mosaic toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/mosaic-pane-terminal.png" alt="mosaic in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/mosaic-pane-desktop-dark.png"><img src="docs/previews/mosaic-pane-desktop-light.png" alt="mosaic in the desktop app" width="300"></picture></td></tr></table>

#### Relay · `/relay`

the API latency lab in a sidebar. Every model request of the main loop and its subagents with latency, time to first token, model, effort, input/output/cache tokens, tokens per second and stop reason; a latency histogram, tokens/sec over time, model mix, p50/p95, the slowest five and cache-read share per request. /relay toggles it.

<table><tr><td valign="top"><img src="docs/previews/relay-pane-terminal.png" alt="relay in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/relay-pane-desktop-dark.png"><img src="docs/previews/relay-pane-desktop-light.png" alt="relay in the desktop app" width="300"></picture></td></tr></table>

#### Spectra · `/spectra`

the context X-ray. The context window broken down by category as a heat grid with a ranked legend, context growth per turn, and an estimate of how many turns remain before auto-compact. /spectra toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/spectra-pane-terminal.png" alt="spectra in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/spectra-pane-desktop-dark.png"><img src="docs/previews/spectra-pane-desktop-light.png" alt="spectra in the desktop app" width="300"></picture></td></tr></table>

#### Switchboard · `/switchboard`

an MCP observatory sidebar. Every MCP server in the session with its tools, calls, errors, average and p95 latency, last call and a status lamp (healthy, erroring, idle, busy); servers with no calls yet too, and per-tool rows on expand. On the desktop a patch bay with glowing cables to the active servers. /switchboard toggles it.

<table><tr><td valign="top"><img src="docs/previews/switchboard-pane-terminal.png" alt="switchboard in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/switchboard-pane-desktop-dark.png"><img src="docs/previews/switchboard-pane-desktop-light.png" alt="switchboard in the desktop app" width="300"></picture></td></tr></table>

#### Taskforge · `/taskforge`

a live kanban of the session's tasks. TodoWrite lists and TaskCreate/TaskUpdate tasks fall into Pending, In progress and Done columns with the active form, time in the column and the owning agent, under a progress bar. /taskforge toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/taskforge-pane-terminal.png" alt="taskforge in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/taskforge-pane-desktop-dark.png"><img src="docs/previews/taskforge-pane-desktop-light.png" alt="taskforge in the desktop app" width="300"></picture></td></tr></table>

#### Terminus · `/terminus`

the session's shell history in a sidebar. Every Bash and PowerShell call of the main loop and its subagents with command, description, cwd, exit status, duration, output size and who ran it; filters for failed and slow runs, copy and re-run buttons. /terminus toggles it.

<table><tr><td valign="top"><img src="docs/previews/terminus-pane-terminal.png" alt="terminus in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/terminus-pane-desktop-dark.png"><img src="docs/previews/terminus-pane-desktop-light.png" alt="terminus in the desktop app" width="300"></picture></td></tr></table>

#### Thermal · `/thermal`

a heatmap of the files this session touches. Reads, edits, writes and searches per file, a heat score that cools over time, grouped as a directory tree under the session folder: an indented heat tree on the terminal, a squarified treemap on the desktop, switchable by heat, reads or edits. /thermal toggles it.

<table><tr><td valign="top"><img src="docs/previews/thermal-pane-terminal.png" alt="thermal in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/thermal-pane-desktop-dark.png"><img src="docs/previews/thermal-pane-desktop-light.png" alt="thermal in the desktop app" width="300"></picture></td></tr></table>

#### Tokenomics · `/tokenomics`

the cost lab. Session cost as the headline, an estimated split by model and by token type, cache hit ratio, burn per hour, cost per turn, a pace forecast and daily and weekly totals across sessions with a 14-day chart. /tokenomics toggles the sidebar.

<table><tr><td valign="top"><img src="docs/previews/tokenomics-pane-terminal.png" alt="tokenomics in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/tokenomics-pane-desktop-dark.png"><img src="docs/previews/tokenomics-pane-desktop-light.png" alt="tokenomics in the desktop app" width="300"></picture></td></tr></table>

#### Vitals · `/vitals`

a btop-style machine monitor sidebar. CPU with a braille history graph, RAM bar and history, disk use, NVIDIA GPU load, memory and temperature, process count, and the Claude side: session time, tool calls, running agents. Samples every 2 s only while open. /vitals toggles it.

<table><tr><td valign="top"><img src="docs/previews/vitals-pane-terminal.png" alt="vitals in the terminal" width="520"></td><td valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/vitals-pane-desktop-dark.png"><img src="docs/previews/vitals-pane-desktop-light.png" alt="vitals in the desktop app" width="300"></picture></td></tr></table>


### Bands above the prompt — the visual show

Live drawings just above the chat input. Every band has a ✕ and its command brings it back.

#### Aurora · `/aurora`

northern lights above the prompt while the model thinks. Shifting curtains whose intensity and speed follow the effort level (low is gentle, max is wild), a calmer single wave while it responds, and a label like 'thinking · xhigh · 12s'. /aurora toggles it.

<img src="docs/previews/aurora-aboveprompt-terminal.png" alt="aurora in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/aurora-aboveprompt-desktop-dark.png"><img src="docs/previews/aurora-aboveprompt-desktop-light.png" alt="aurora in the desktop app" width="820"></picture>

</details>

#### Blackbox · `/blackbox`

a flight recorder above the prompt. A live Gantt of the current turn: the main loop and each subagent on its own lane, every tool call a bar in its family color, model requests as ticks, a moving now cursor on an auto-scaling time axis; the last turn stays dimmed until the next. /blackbox toggles it.

<img src="docs/previews/blackbox-aboveprompt-terminal.png" alt="blackbox in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/blackbox-aboveprompt-desktop.svg" alt="blackbox in the desktop app, animated" width="820">

</details>

#### Glyphfall · `/glyphfall`

matrix rain of tool activity above the prompt while Claude works. Every tool call drops its name and detail as a wave of letters, colored by tool family, with bright heads and fading tails, over a sparse rain of katakana; the last five tools sit below as colored chips. /glyphfall toggles it.

<img src="docs/previews/glyphfall-aboveprompt-terminal.png" alt="glyphfall in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/glyphfall-aboveprompt-desktop.svg" alt="glyphfall in the desktop app, animated" width="820">

</details>

#### Halo · `/halo`

a one-row mood line above the prompt whose color and motion tell what Claude is doing: calm blue breathing when idle, a violet flow while it requests and writes, a magenta shimmer while it thinks, the running tool's color racing across, a red flash when a tool fails, an amber blink when it waits for you. /halo toggles it.

<img src="docs/previews/halo-aboveprompt-terminal.png" alt="halo in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/halo-aboveprompt-desktop.svg" alt="halo in the desktop app, animated" width="820">

</details>

#### Heartline · `/heartline`

a neon EKG of the session drawn above the prompt. Every tool call is a spike colored by its family, every model request a blip, a failed tool a red inverted spike; the trace drifts green to red with context fill, with a live bpm (tool calls per minute) and ctx readout. /heartline toggles it.

<img src="docs/previews/heartline-aboveprompt-terminal.png" alt="heartline in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/heartline-aboveprompt-desktop.svg" alt="heartline in the desktop app, animated" width="820">

</details>

#### Orrery · `/orrery`

subagents as planets circling a central sun above the prompt. Running agents orbit at a speed set by their tokens per second, finished ones settle into a faint outer ring, failed ones flash a red cross; a legend names up to four with type and elapsed time. /orrery toggles it.

<img src="docs/previews/orrery-aboveprompt-terminal.png" alt="orrery in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/orrery-aboveprompt-desktop.svg" alt="orrery in the desktop app, animated" width="820">

</details>

#### Questline · `/questline`

task progress above the prompt. One segmented bar for the session's todos and tasks (done green, running violet and pulsing, waiting gray), the count, what is running now and for how long. Hides itself two minutes after everything is done. /questline toggles it.

<img src="docs/previews/questline-aboveprompt-terminal.png" alt="questline in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/questline-aboveprompt-desktop.svg" alt="questline in the desktop app, animated" width="820">

</details>

#### Skies · `/skies`

the session's weather above the prompt. Tool failures, context and rate-limit pressure, stalls and the local hour make clear skies, clouds, rain, storms with lightning, fog, a starry night, or a rainbow after a storm clears; an animated scene and a forecast line. /skies toggles it.

<img src="docs/previews/skies-aboveprompt-terminal.png" alt="skies in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/skies-aboveprompt-desktop.svg" alt="skies in the desktop app, animated" width="820">

</details>

#### Storyboard · `/storyboard`

Claude narrates its own progress. A chapter tool the model calls at each phase change drives a band above the prompt: the chapter title, a five-stage rail (explore, plan, build, verify, ship) with the active stage glowing, step 3/5 and a note. /storyboard toggles the band, /storyboard log opens the chapter history.

<img src="docs/previews/storyboard-pane-terminal.png" alt="storyboard in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/storyboard-pane-desktop-dark.png"><img src="docs/previews/storyboard-pane-desktop-light.png" alt="storyboard in the desktop app" width="820"></picture>

</details>

#### Throttle · `/throttle`

a car dashboard above the prompt. Speedometer of output tokens per second, fuel gauge of the 5-hour limit, temperature of the context, an odometer of session dollars, and check-engine, fuel and overheat lamps. /throttle toggles it.

<img src="docs/previews/throttle-aboveprompt-terminal.png" alt="throttle in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/throttle-aboveprompt-desktop.svg" alt="throttle in the desktop app, animated" width="820">

</details>

#### Tidewater · `/tidewater`

the live diff of the current turn as tides above the prompt. Every file Claude edits gets its own pool of rolling waves, a green swell for added lines and a red ebb for removed ones, with file chips and totals like '+128 −42 · 6 files'. From the first edit of a turn until the next prompt. /tidewater toggles it.

<img src="docs/previews/tidewater-aboveprompt-terminal.png" alt="tidewater in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/tidewater-aboveprompt-desktop.svg" alt="tidewater in the desktop app, animated" width="820">

</details>

#### Verdict · `/verdict`

test, build and lint results above the prompt. Spots the test runners, type checkers, linters and builds Claude runs (vitest, jest, pytest, go test, cargo, dotnet, mocha, bun, tsc, eslint, npm run build, maven, gradle…), parses pass/fail/skip and error counts, and shows chips like '✓ vitest 142 · ✗ jest 3 failed · ✓ tsc 0 errors' with a red pulse on failures and a sparkline of the last 10 runs. /verdict opens a pane of recent runs with the failing test names and first error lines.

<img src="docs/previews/verdict-pane-terminal.png" alt="verdict in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/verdict-aboveprompt-desktop.svg" alt="verdict in the desktop app, animated" width="820">

</details>

#### Warpdrive · `/warpdrive`

a starfield at warp above the prompt. Stars stream out of the center at the speed of Claude's live output token rate: a slow drift while it thinks, hyperspace streaks while it writes. When a turn ends, a jump flash and a line like '⇢ arrived · 42s · 18.4k tok'. /warpdrive toggles it.

<img src="docs/previews/warpdrive-aboveprompt-terminal.png" alt="warpdrive in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/warpdrive-aboveprompt-desktop.svg" alt="warpdrive in the desktop app, animated" width="820">

</details>


### Transcript and spinner

Small, tasteful additions to what Claude Code already draws.

#### Compass · `/compass`

the single most useful hint under the prompt. In order: the 5-hour limit near its end with its reset, a context window near full, agents still working, uncommitted changes after edits, a draft left waiting; otherwise the engine's own hint. /compass toggles it.

<img src="docs/previews/compass-prompthint-terminal.png" alt="compass in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/compass-prompthint-desktop-dark.png"><img src="docs/previews/compass-prompthint-desktop-light.png" alt="compass in the desktop app" width="820"></picture>

</details>

#### Mantra · `/mantra`

a themed spinner. The working line's word rotates through a pack of original gerunds (cosmic, zen, pirate, turkish, hacker) and its tail names the tool running now with its elapsed time, or the effort while the model thinks. /mantra <pack> switches, /mantra off hands the line back.

<img src="docs/previews/mantra-spinner-terminal.png" alt="mantra in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/mantra-spinner-desktop-dark.png"><img src="docs/previews/mantra-spinner-desktop-light.png" alt="mantra in the desktop app" width="820"></picture>

</details>

#### Stamp · `/stamp`

a receipt on every finished turn. The closing 'Baked for 42s' line becomes a compact row of duration, tool calls by family as colored chips, tokens in and out, the turn's cost and the context fill with its change. /stamp toggles it.

<img src="docs/previews/stamp-turnduration-terminal.png" alt="stamp in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/stamp-turnduration-desktop-dark.png"><img src="docs/previews/stamp-turnduration-desktop-light.png" alt="stamp in the desktop app" width="820"></picture>

</details>

#### Toolmarks · `/toolmarks`

badges on tool rows. Each finished call gets a family-colored glyph and its duration at the row's end, Bash calls their exit status, failed calls a red mark, and a folded group its total time and failures. /toolmarks toggles them.

<img src="docs/previews/toolmarks-tooluse-terminal.png" alt="toolmarks in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/toolmarks-tooluse-desktop-dark.png"><img src="docs/previews/toolmarks-tooluse-desktop-light.png" alt="toolmarks in the desktop app" width="820"></picture>

</details>


### Companions

A little life around the work.

#### Clawdling · `/clawdling`

a pixel crab companion that lives above the prompt. It blinks and sways, scuttles while tools run, thinks in bubbles, sweats past 80% context, dozes near the 5-hour limit and dances on a five-turn streak. It earns XP from tools and turns, levels up into a party hat, sunglasses, a scarf and a crown, and quips about what it sees. /clawdling toggles it, /clawdling feed treats it.

<img src="docs/previews/clawdling-aboveprompt-terminal.png" alt="clawdling in the terminal" width="820">

<details><summary>Desktop app (animated)</summary>

<img src="docs/previews/clawdling-aboveprompt-desktop.svg" alt="clawdling in the desktop app, animated" width="820">

</details>

#### Epilogue · `/epilogue`

a recap band after every turn. Duration, tool families as colored chips, files written, subagents spawned, tokens and estimated cost, the session cost delta and failed tools, with an optional AI one-liner. /epilogue opens the last 20 recaps.

<img src="docs/previews/epilogue-pane-terminal.png" alt="epilogue in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/epilogue-pane-desktop-dark.png"><img src="docs/previews/epilogue-pane-desktop-light.png" alt="epilogue in the desktop app" width="820"></picture>

</details>

#### Laurels · `/laurels`

32 achievements earned from what the session does (Hydra, Night Owl, Cache Wizard, Bug Squasher, Polyglot, Centurion, Committed and more), kept across sessions with their unlock dates. A toast and a six-second celebration band on each unlock; /laurels opens the medal gallery with progress toward the locked ones.

<img src="docs/previews/laurels-pane-terminal.png" alt="laurels in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/laurels-pane-desktop-dark.png"><img src="docs/previews/laurels-pane-desktop-light.png" alt="laurels in the desktop app" width="820"></picture>

</details>

#### Tempo · `/tempo`

a Pomodoro focus timer above the prompt. A tomato, the phase, a ring (desktop) or a sizzling bar (terminal) and the time left; long breaks every fourth round, a toast at each phase end and a tally of focus rounds per day. /tempo start [work] [break], stop, skip.

<img src="docs/previews/tempo-aboveprompt-terminal.png" alt="tempo in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/tempo-aboveprompt-desktop-dark.png"><img src="docs/previews/tempo-aboveprompt-desktop-light.png" alt="tempo in the desktop app" width="820"></picture>

</details>


### Status line

#### Marquee · `/marquee`

a status-line ticker. Model and effort, context fill, 5-hour and weekly limits with the reset countdown, session cost, git branch with ahead and dirty counts, and the tool running now, refreshed every second; it scrolls like a marquee when longer than its width. /marquee toggles it.


### Sound

Synthesized here, no samples. The engine plays audio on macOS and the desktop app.

#### Lofi · `/lofi`

generative lo-fi music while Claude works. Four original synthesized loops (focus, deep, night, sunny: warm chord pads, an electric piano, soft kick and hats with swing, vinyl crackle) loop from the start of a turn until it ends, and stop when Claude is idle. Opt-in: /lofi on. A tiny band shows '♪ lofi · deep' with a dancing equalizer while it plays.

<img src="docs/previews/lofi-aboveprompt-terminal.png" alt="lofi in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/lofi-aboveprompt-desktop-dark.png"><img src="docs/previews/lofi-aboveprompt-desktop-light.png" alt="lofi in the desktop app" width="820"></picture>

</details>

#### Resonance · `/resonance`

a synthesized soundscape for the session. A soft tick per tool, a bonk on failures, a gong after long turns, a bell when a subagent finishes, an alarm when a rate-limit window crosses 80% or 95%, a chime on the first turn. /resonance mutes.


### Guards

Watch the risky moments and step in.

#### Ballast · `/ballast`

a context coach. A toast when the context window passes warnAt, then a band with an anchor and a water-level gauge at actAt: "⚓ ctx 89% — compact before the next big task" with Compact now (queued to the end of a running turn) and Not now. Optional auto-compaction between turns, and a before→after toast for every compaction. /ballast toggles the band.

<img src="docs/previews/ballast-aboveprompt-terminal.png" alt="ballast in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/ballast-aboveprompt-desktop-dark.png"><img src="docs/previews/ballast-aboveprompt-desktop-light.png" alt="ballast in the desktop app" width="820"></picture>

</details>

#### Thrift · `/thrift`

a frugal mode. /thrift on|off|auto; while on, every prompt carries a short note asking Claude to be economical (targeted reads, no broad searches or subagents unless needed, concise answers). Auto turns it on when the 5-hour or weekly limit passes autoAt and off after the window resets. A band with a spinning coin, and /thrift compares the average cost of thrift turns with normal ones.

<img src="docs/previews/thrift-aboveprompt-terminal.png" alt="thrift in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/thrift-aboveprompt-desktop-dark.png"><img src="docs/previews/thrift-aboveprompt-desktop-light.png" alt="thrift in the desktop app" width="820"></picture>

</details>

#### Warden · `/warden`

a guard for destructive shell commands. Before Claude or a subagent runs rm -rf on a broad path, git push --force, reset --hard, clean -fd, DROP TABLE, mkfs, format, curl | sh and their kin, warden asks you (Allow once / Deny) and refuses when no one can answer. A band flashes for 8 s after a block; /warden lists the rules and this session's log.

<img src="docs/previews/warden-aboveprompt-terminal.png" alt="warden in the terminal" width="820">

<details><summary>Desktop app</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/warden-aboveprompt-desktop-dark.png"><img src="docs/previews/warden-aboveprompt-desktop-light.png" alt="warden in the desktop app" width="820"></picture>

</details>


### Tools

#### Polaroid · `/polaroid`

/polaroid snapshots the session as a self-contained dark-neon HTML report in .kozmos/reports: model, duration, cost, tokens, context peak, rate limits, tool calls by family, a timeline of turns, subagents, files touched and commands run, all collected live. It answers with the path and copies it. /polaroid md writes Markdown instead.


<!-- gallery:end -->

## Notes

- **Bands stack.** Every band draws under whatever the others drew, so several can run at once; each hides with its `✕` and returns with its command.
- **Sidebars open on demand.** Only `bridge` opens itself at start (`autoOpen` in its options); the rest open with their command or from `/kozmos`.
- **Sound** (`resonance`, `lofi`): the engine has an audio player on macOS and in the desktop app; on a Windows or Linux terminal they stay silent. `lofi` is off until `/lofi on`.
- **warden** asks before destructive shell commands and refuses when no one can answer (`-p` runs). Set its `mode` to `warn` or `deny` to change that.
- **storyboard** adds one short line to the system prompt so Claude calls its `chapter` tool; turn it off with its `nudge` option.
- **polaroid** writes reports into `<project>/.kozmos/reports/`. Add `.kozmos/` to that project's `.gitignore`.
- Costs a mod shows for a subagent or a split by model are estimates from list prices; the session total is the engine's own figure.

## Developing

```
npm install                       # TypeScript and playwright-core
node scripts/validate-all.mjs     # sync the shared kit, rebuild the catalog, tsc, validate and test every mod
node scripts/capture-previews.mjs # play the made-up session through each mod
node scripts/render-previews.mjs  # render the drawings to docs/previews/*.png
node scripts/build-readme.mjs     # rebuild this README's gallery
```

- `shared/kz.ts`, `shared/probe.ts` — the shared kit: palette, gauges, sparklines, braille graphs, a raster canvas, SVG helpers, prices, git and machine parsers. `scripts/sync-shared.mjs` copies it into each mod's `hooks/lib/`, because a hooks module may only import files of its own plugin.
- `scripts/build-catalog.mjs` writes `.claude-plugin/marketplace.json` and the hub's catalog.
- `AUTHORING.md` — the rules the engine enforces and where every figure comes from, for writing a new mod.
- `types/claude-code.d.ts` — the plugin API declarations of the Claude Code build the bundle targets.

All code in this repository was written for KOZMOS. MIT licensed.

---

## Türkçe

**Claude Code için 48 canlı ve görsel mod: hem terminalde hem desktop uygulamasında.**

Chat input'un üstünde, sidebar'da, transcript'te, status line'da ve hoparlörde
gösterdikleri: Claude'un şu an ne yaptığı, ne kadar harcadığı, 5 saatlik ve haftalık
limitlere ne kadar yaklaştığın, subagent'ların ne yaptığı, context'in ne kadar dolu
olduğu, git ağacının durumu ve makinenin ne kadar yük altında olduğu.

KOZMOS birbirinden bağımsız **function-hooks plugin**'lerinden (modlardan) oluşan
bir paket. İster tek mod, ister bir preset, ister hepsini kur. Her mod iki kez çizer:
**terminal** için (renkli metin, hücre raster'ları, 30 fps animasyon) ve **desktop**
uygulaması için (açık ve koyu temaya uyan animasyonlu SVG).

### Kurulum

Claude Code içinden:

```
/plugin marketplace add ersinkoc/claude-mods
/plugin install kozmos@kozmos
/plugin install bridge@kozmos
```

Ya da repoyu klonlayıp installer ile (menüden seçim, presetler, kaldırma):

```powershell
./install.ps1                    # interaktif menü
./install.ps1 -Preset showtime   # essentials | showtime | all
./install.ps1 -Uninstall         # hepsini kaldır
```

Kurulumdan sonra yeni bir oturum aç (ya da `/reload-plugins` çalıştır) ve
**`/kozmos`** yaz: hub bütün modları listeler, her birini tek tıkla açar.

### Mod grupları

- **Sidebar'lar:** bridge (görev kontrol merkezi), hivemind (agent ağacı), taskforge (kanban), chronicle (zaman çizelgesi), gearbox (tool analitiği), tokenomics (maliyet laboratuvarı), hourglass (limit kâhini), spectra (context röntgeni), mosaic (aktivite takvimi), gitscope (git radarı), vitals (sistem monitörü), thermal (dosya ısı haritası), terminus (shell geçmişi), breadcrumbs (web izi), faultline (hata merceği), relay (API gecikme laboratuvarı), almanac (oturum almanağı), launchpad (komut ve prompt düğmeleri), switchboard (MCP gözlemevi)
- **Prompt üstü bantlar:** heartline (EKG), orrery (agent gezegenleri), glyphfall (matrix yağmuru), aurora (düşünürken kuzey ışıkları), throttle (araba göstergesi), blackbox (uçuş kaydedici), questline (görev ilerlemesi), halo (durum çizgisi), skies (oturum hava durumu), warpdrive (token hızıyla warp), tidewater (diff dalgaları), verdict (test ve build sonuçları), storyboard (Claude'un anlattığı faz rayı)
- **Transcript ve spinner:** stamp (turn fişi), mantra (temalı spinner kelimeleri, Türkçe paket dahil), toolmarks (tool satırı rozetleri), compass (prompt altı ipucu)
- **Yoldaşlar:** clawdling (XP kazanan pixel yengeç), laurels (başarımlar), tempo (pomodoro), epilogue (turn özeti)
- **Guard'lar:** warden (tehlikeli komut kapısı), ballast (context koçu), thrift (tasarruf modu)
- **Status line, ses ve araçlar:** marquee (kayan şerit), resonance (ses manzarası), lofi (çalışırken lofi müzik), polaroid (HTML oturum raporu)

Her bandın gizlemek için bir `✕` düğmesi var; kendi komutu bandı geri açar.

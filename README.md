# KOZMOS

**Live, visual mods for Claude Code: terminal CLI and desktop app.**
Above the chat input, in the sidebar, on the status line and in your speakers:
what Claude is doing right now, what it costs, how close you are to the limits,
what your subagents are up to, the shape of your git tree and the heat of your
machine.

KOZMOS is a bundle of independent **function-hooks plugins** ("mods"). Install
one, a preset, or all of them. Each mod draws for the terminal (colored text,
cell rasters, 30 fps surface animations) and for the desktop app (animated SVG
that follows light and dark themes).

> Requires Claude Code **2.1.290+**, where function hooks are on by default.
> The mod API is early access and may change between releases.

## Install

### From GitHub, inside Claude Code

```
/plugin marketplace add ersinkoc/claude-mods
/plugin install bridge@kozmos
/plugin install kozmos@kozmos
```

Or one line per mod: `/plugin install orrery --marketplace ersinkoc/claude-mods`.

### With the installer (pick from a menu, presets, uninstall)

```bash
git clone https://github.com/ersinkoc/claude-mods.git
cd claude-mods
```

```powershell
# Windows
./install.ps1                    # interactive menu
./install.ps1 -Preset showtime   # essentials | showtime | all
./install.ps1 -Mods bridge,orrery,halo
```

```bash
# macOS / Linux / Git Bash
./install.sh
./install.sh --preset all
```

The installer adds this folder as the `kozmos` plugin marketplace and runs
`claude plugin install <mod>@kozmos` for what you pick. A folder marketplace
is read from the folder itself, so after `git pull` a `/reload-plugins`
picks up the new code. Mods installed at the user scope load in the CLI and
in the desktop app's Code tab. Then type **`/kozmos`** to open the hub.

From inside Claude Code, without the script:

```
/plugin marketplace add ersinkoc/claude-mods
/plugin install bridge@kozmos
```

To try one mod for a single session: `claude --plugin-dir mods/bridge`.

## The mods

### Hub
| Mod | Command | What it is |
| --- | --- | --- |
| **kozmos** | `/kozmos` | Starfield launcher listing every KOZMOS mod, what is installed, one-click open. `/kozmos list` prints them. |

### Sidebars
| Mod | Command | What it shows |
| --- | --- | --- |
| **bridge** | `/bridge` | Mission control: model·effort, context gauge, 5h / 7d limits with reset countdowns, cost + burn rate, git branch and tree, CPU / RAM / GPU, running agents, the tool running now. |
| **hivemind** | `/hivemind` | The subagent swarm as a live tree: status, model, elapsed, tokens, est. $, context %, current tool. |
| **taskforge** | `/taskforge` | Kanban of the session's tasks (TodoWrite / Task tools): Pending · In progress · Done. |
| **chronicle** | `/chronicle` | Session timeline: prompts, turns, agents, commits, errors, compactions, limit milestones. |
| **gearbox** | `/gearbox` | Tool analytics: calls, errors, avg / p95 duration, slowest calls. |
| **tokenomics** | `/tokenomics` | Cost lab: $ by model and token type, cache hit ratio, burn rate, daily history. |
| **hourglass** | `/hourglass` | Limit oracle: burn rate per window, ETA to 100 % vs reset, 80 / 95 % alerts. |
| **spectra** | `/spectra` | Context X-ray: breakdown heatmap, growth per turn, turns left before auto-compact. |
| **mosaic** | `/mosaic` | GitHub-style activity calendar across sessions: turns, tools, tokens, $. |
| **gitscope** | `/gitscope` | Git radar: branch, ahead / behind, staged / unstaged, recent commits, per-file +/−. |
| **vitals** | `/vitals` | btop-style machine monitor: CPU, RAM, disk, GPU with live graphs. |
| **thermal** | `/thermal` | Heatmap / treemap of the files the session reads and edits. |

### Bands above the prompt: the visual show
| Mod | Command | What it shows |
| --- | --- | --- |
| **heartline** | `/heartline` | Neon EKG: every tool call a spike, every model request a blip, color by context fill. |
| **orrery** | `/orrery` | Subagents as planets orbiting Claude, speed by their token rate. |
| **glyphfall** | `/glyphfall` | Matrix rain of the tools at work, spelled in their colors. |
| **aurora** | `/aurora` | Northern lights while the model thinks, wilder with higher effort. |
| **throttle** | `/throttle` | Car dashboard: tokens/s speedometer, limit fuel gauge, context temperature, $ odometer. |
| **blackbox** | `/blackbox` | Flight recorder: live Gantt of the current turn, one lane per agent. |
| **questline** | `/questline` | Task progress bar with the active task's name. |
| **halo** | `/halo` | A thin mood line: idle, thinking, tool, error, waiting on you. |
| **skies** | `/skies` | Session weather: storms when tools fail, fog when context is full. |

### Companions
| Mod | Command | What it is |
| --- | --- | --- |
| **clawdling** | `/clawdling` | A pixel crab that reacts to the session, earns XP and unlocks accessories. |
| **laurels** | `/laurels` | 24+ achievements with toasts and a badge gallery. |
| **tempo** | `/tempo start` | Pomodoro focus timer above the prompt. |
| **epilogue** | `/epilogue` | A recap after every turn: time, tools, files, tokens, $. |

### Status line and sound
| Mod | Command | What it is |
| --- | --- | --- |
| **marquee** | `/marquee` | A scrolling status-line ticker of everything at once. |
| **resonance** | `/resonance` | A soundscape: ticks, chimes, a gong when long turns finish, alarms near limits. |

Every band has a `✕` to hide it, and its command toggles it back.

## Presets

- **essentials**: kozmos, bridge, halo, questline, marquee, hivemind, hourglass
- **showtime**: essentials + heartline, orrery, glyphfall, aurora, throttle, clawdling, skies, laurels
- **all**: everything

## Developing

```
npm install                       # TypeScript for type-checking
node scripts/validate-all.mjs     # sync shared kit, rebuild catalog, tsc, validate + test every mod
```

- `shared/kz.ts`, `shared/probe.ts`: the shared kit (palette, gauges, sparklines, braille graphs, raster canvas, SVG helpers, prices, git and machine parsers). `scripts/sync-shared.mjs` copies it into each mod's `hooks/lib/`, because a hooks module may only import files of its own plugin.
- `scripts/build-catalog.mjs` writes `.claude-plugin/marketplace.json` and the hub's catalog.
- `AUTHORING.md`: the rules the engine enforces and the data sources, for writing a new mod.
- `types/claude-code.d.ts`: the plugin API declarations of the Claude Code build the bundle targets.

All code in this repository was written for KOZMOS.

---

## Türkçe

**Claude Code için canlı ve görsel modlar: terminal CLI'da ve desktop uygulamasında.**
Chat input'un üstünde, sidebar'da, status line'da ve hoparlörde gösterdikleri:
Claude'un şu an ne yaptığı, ne kadar harcadığı, limitlere ne kadar yakın olduğun,
subagent'ların ne yaptığı, git ağacının durumu ve makinenin ne kadar yük altında
olduğu.

KOZMOS birbirinden bağımsız **function-hooks plugin**'lerinden (modlardan)
oluşan bir paket. İster tek mod, ister bir preset, ister hepsini kur. Her mod
terminal için (renkli metin, hücre raster'ları, 30 fps animasyon) ve desktop
uygulaması için (açık ve koyu temaya uyan animasyonlu SVG) ayrı çizer.

### Kurulum

Claude Code içinden:

```
/plugin marketplace add ersinkoc/claude-mods
/plugin install bridge@kozmos
```

Ya da repoyu klonlayıp installer ile (menüden seçim, presetler, kaldırma):

```powershell
./install.ps1                    # interaktif menü
./install.ps1 -Preset showtime   # essentials | showtime | all
./install.ps1 -Mods bridge,orrery,halo
./install.ps1 -Uninstall         # hepsini kaldır
```

Kurulumdan sonra yeni bir Claude Code oturumu aç (ya da `/reload-plugins`
çalıştır) ve **`/kozmos`** yaz: hub bütün modları listeler, her birini tek
tıkla açar. Kullanıcı kapsamında kurulan modlar hem CLI'da hem desktop
uygulamasının Code sekmesinde yüklenir.

### Modlar

- **Sidebar'lar:** bridge (görev kontrol merkezi), hivemind (agent ağacı), taskforge (kanban), chronicle (zaman çizelgesi), gearbox (tool analitiği), tokenomics (maliyet laboratuvarı), hourglass (limit kâhini), spectra (context röntgeni), mosaic (aktivite takvimi), gitscope (git radarı), vitals (sistem monitörü), thermal (dosya ısı haritası)
- **Prompt üstü bantlar:** heartline (EKG), orrery (agent gezegenleri), glyphfall (matrix yağmuru), aurora (düşünürken kuzey ışıkları), throttle (araba göstergesi), blackbox (uçuş kaydedici), questline (görev ilerlemesi), halo (durum çizgisi), skies (oturum hava durumu)
- **Yoldaşlar:** clawdling (XP kazanan pixel yengeç), laurels (başarımlar), tempo (pomodoro), epilogue (turn özeti)
- **Status line ve ses:** marquee (kayan şerit), resonance (ses manzarası)

Her bandın gizlemek için bir `✕` düğmesi var. Kendi komutu bandı geri açar.

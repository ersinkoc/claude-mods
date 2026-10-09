#!/usr/bin/env bash
# KOZMOS installer for Claude Code (macOS / Linux / Git Bash).
#   ./install.sh                     interactive menu
#   ./install.sh --preset showtime   essentials | showtime | all
#   ./install.sh --mods bridge,halo,orrery
#   ./install.sh --scope project     user (default) | project | local
#   ./install.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKET=kozmos
SCOPE=user
PRESET=""
MODS=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --preset) PRESET="$2"; shift 2 ;;
    --mods) MODS="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n 2,7p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

c() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
printf '\n  %s %s %s %s %s %s  %s\n\n' "$(c '1;35' K)" "$(c '1;36' O)" "$(c '1;34' Z)" "$(c '1;35' M)" "$(c '1;36' O)" "$(c '1;34' S)" "$(c 90 'live mods for Claude Code')"

command -v claude >/dev/null || { echo "The claude CLI was not found on PATH." >&2; exit 1; }
command -v node >/dev/null || { echo "node is needed to read the catalog." >&2; exit 1; }
CATALOG="$ROOT/.claude-plugin/marketplace.json"
[ -f "$CATALOG" ] || { echo "marketplace.json missing; run: node scripts/build-catalog.mjs" >&2; exit 1; }

# name<TAB>category<TAB>blurb, one per line.
ROWS="$(node -e '
  const p = require(process.argv[1]).plugins
  for (const m of p) console.log([m.name, m.category, m.description.replace(/^KOZMOS [^:]*:\s*/, "")].join("\t"))
' "$CATALOG")"
ALL="$(printf '%s\n' "$ROWS" | cut -f1 | tr '\n' ' ')"
ESSENTIALS="kozmos bridge halo questline marquee hivemind hourglass compass stamp warden ballast"
SHOWTIME="$ESSENTIALS heartline orrery glyphfall aurora throttle clawdling skies laurels warpdrive tidewater storyboard mantra verdict"

if [ "$UNINSTALL" = 1 ]; then
  for n in $ALL; do claude plugin uninstall "$n@$MARKET" -s "$SCOPE" >/dev/null 2>&1 || true; echo "  removed $n"; done
  claude plugin marketplace remove "$MARKET" >/dev/null 2>&1 || true
  echo "  KOZMOS removed."; exit 0
fi

PICK=""
if [ -n "$MODS" ]; then PICK="$(echo "$MODS" | tr ',' ' ')"
elif [ "$PRESET" = all ]; then PICK="$ALL"
elif [ "$PRESET" = essentials ]; then PICK="$ESSENTIALS"
elif [ "$PRESET" = showtime ]; then PICK="$SHOWTIME"
else
  i=0
  declare -a INDEX
  while IFS=$'\t' read -r name cat blurb; do
    i=$((i + 1)); INDEX[$i]="$name"
    printf '  %2d  %-12s %-10s %s\n' "$i" "$(c 35 "$name")" "$(c 36 "$cat")" "$(c 90 "${blurb:0:64}")"
  done <<< "$ROWS"
  echo
  echo "  $(c 33 'e = essentials   s = showtime   a = all   or numbers like 1,2,7-10')"
  read -r -p "  Install: " ANSWER
  case "$ANSWER" in
    e|essentials) PICK="$ESSENTIALS" ;;
    s|showtime) PICK="$SHOWTIME" ;;
    a|all) PICK="$ALL" ;;
    *)
      for part in $(echo "$ANSWER" | tr ',' ' '); do
        if [[ "$part" =~ ^([0-9]+)-([0-9]+)$ ]]; then
          for k in $(seq "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"); do PICK="$PICK ${INDEX[$k]:-}"; done
        elif [[ "$part" =~ ^[0-9]+$ ]]; then PICK="$PICK ${INDEX[$part]:-}"
        else PICK="$PICK $part"; fi
      done ;;
  esac
fi
[ -n "${PICK// }" ] || { echo "  Nothing selected."; exit 0; }

if claude plugin marketplace list 2>/dev/null | grep -qw "$MARKET"; then
  claude plugin marketplace update "$MARKET" >/dev/null
else
  claude plugin marketplace add "$ROOT"
fi

ok=0; total=0
for n in $PICK; do
  total=$((total + 1))
  printf '  %s %-12s' "$(c 35 '◆')" "$n"
  if claude plugin install "$n@$MARKET" -s "$SCOPE" -y >/dev/null 2>&1; then echo " $(c 32 installed)"; ok=$((ok + 1)); else echo " $(c 31 failed)"; fi
done
echo
echo "  $(c 32 "$ok/$total mods installed ($SCOPE scope).")"
echo "  $(c 36 'Start a new Claude Code session (or /reload-plugins), then type /kozmos.')"

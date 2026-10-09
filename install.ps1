<#
.SYNOPSIS
  KOZMOS installer for Claude Code (Windows / PowerShell).

.DESCRIPTION
  Adds this folder as the "kozmos" plugin marketplace and installs the mods you pick.
  A folder marketplace is read from the folder itself, so `git pull` + /reload-plugins
  updates every installed mod. Mods installed at the user scope load in the terminal
  CLI and in the desktop app's Code tab alike.

.EXAMPLE
  ./install.ps1                       # interactive menu
  ./install.ps1 -Preset showtime      # essentials | showtime | all
  ./install.ps1 -Mods bridge,halo,orrery
  ./install.ps1 -Uninstall            # remove every KOZMOS mod and the marketplace
#>
[CmdletBinding()]
param(
  [ValidateSet('essentials', 'showtime', 'all')] [string] $Preset,
  [string[]] $Mods,
  [ValidateSet('user', 'project', 'local')] [string] $Scope = 'user',
  [switch] $Uninstall,
  [switch] $List
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Market = 'kozmos'

function Write-Banner {
  $c = 'Magenta', 'Cyan', 'Blue', 'Magenta', 'Cyan', 'Blue'
  $w = 'K', 'O', 'Z', 'M', 'O', 'S'
  Write-Host ''
  Write-Host '  ' -NoNewline
  for ($i = 0; $i -lt 6; $i++) { Write-Host "$($w[$i]) " -ForegroundColor $c[$i] -NoNewline }
  Write-Host '  live mods for Claude Code' -ForegroundColor DarkGray
  Write-Host ''
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'The `claude` CLI was not found on PATH. Install Claude Code first: https://claude.com/claude-code' -ForegroundColor Red
  exit 1
}

$catalogPath = Join-Path $Root '.claude-plugin/marketplace.json'
if (-not (Test-Path $catalogPath)) {
  Write-Host 'marketplace.json is missing; run `node scripts/build-catalog.mjs` first.' -ForegroundColor Red
  exit 1
}
$catalog = (Get-Content $catalogPath -Raw | ConvertFrom-Json).plugins

$Presets = @{
  essentials = @('kozmos', 'bridge', 'halo', 'questline', 'marquee', 'hivemind', 'hourglass', 'compass', 'stamp', 'warden', 'ballast')
  showtime   = @('kozmos', 'bridge', 'halo', 'questline', 'marquee', 'hivemind', 'hourglass', 'compass', 'stamp', 'warden', 'ballast', 'heartline', 'orrery', 'glyphfall', 'aurora', 'throttle', 'clawdling', 'skies', 'laurels', 'warpdrive', 'tidewater', 'storyboard', 'mantra', 'verdict')
}

Write-Banner

if ($List) {
  foreach ($p in $catalog) { Write-Host ('  {0,-12} {1,-10} {2}' -f $p.name, $p.category, ($p.description -replace '^KOZMOS [^:]*:\s*', '')) }
  exit 0
}

if ($Uninstall) {
  foreach ($p in $catalog) {
    Write-Host "  removing $($p.name)" -ForegroundColor DarkGray
    & claude plugin uninstall "$($p.name)@$Market" -s $Scope 2>$null | Out-Null
  }
  & claude plugin marketplace remove $Market 2>$null | Out-Null
  Write-Host '  KOZMOS removed.' -ForegroundColor Green
  exit 0
}

# Pick the mods.
$names = @()
if ($Mods) { $names = $Mods | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
elseif ($Preset -eq 'all') { $names = $catalog.name }
elseif ($Preset) { $names = $Presets[$Preset] }
else {
  $groups = [ordered]@{ hub = 'Hub'; pane = 'Sidebars'; band = 'Bands above the prompt'; transcript = 'Transcript and spinner'; companion = 'Companions'; status = 'Status line'; sound = 'Sound'; guard = 'Guards'; tool = 'Tools'; extra = 'Extras' }
  $i = 0
  $index = @{}
  foreach ($g in $groups.Keys) {
    $inGroup = $catalog | Where-Object { $_.category -eq $g }
    if (-not $inGroup) { continue }
    Write-Host "  $($groups[$g])" -ForegroundColor Cyan
    foreach ($p in $inGroup) {
      $i++
      $index[$i] = $p.name
      $blurb = ($p.description -replace '^KOZMOS [^:]*:\s*', '')
      if ($blurb.Length -gt 70) { $blurb = $blurb.Substring(0, 69) + '…' }
      Write-Host ('   {0,2}  {1,-12}' -f $i, $p.name) -NoNewline
      Write-Host " $blurb" -ForegroundColor DarkGray
    }
  }
  Write-Host ''
  Write-Host '  e = essentials   s = showtime   a = all   or numbers like 1,2,7-10' -ForegroundColor Yellow
  $answer = Read-Host '  Install'
  switch -Regex ($answer.Trim()) {
    '^(e|essentials)$' { $names = $Presets.essentials; break }
    '^(s|showtime)$' { $names = $Presets.showtime; break }
    '^(a|all)$' { $names = $catalog.name; break }
    default {
      foreach ($part in ($answer -split '[,\s]+' | Where-Object { $_ })) {
        if ($part -match '^(\d+)-(\d+)$') { $names += ($Matches[1]..$Matches[2] | ForEach-Object { $index[[int]$_] }) }
        elseif ($part -match '^\d+$') { $names += $index[[int]$part] }
        else { $names += $part }
      }
    }
  }
}
$known = $catalog.name
$names = $names | Where-Object { $_ } | Select-Object -Unique
$unknown = $names | Where-Object { $known -notcontains $_ }
if ($unknown) { Write-Host "  Unknown mods: $($unknown -join ', ')" -ForegroundColor Red; exit 1 }
if (-not $names) { Write-Host '  Nothing selected.' -ForegroundColor Yellow; exit 0 }

# The marketplace: add it, or refresh it when it is already there.
$have = (& claude plugin marketplace list 2>$null) -join "`n"
if ($have -match "(?m)\b$Market\b") {
  & claude plugin marketplace update $Market | Out-Null
} else {
  & claude plugin marketplace add $Root
  if ($LASTEXITCODE -ne 0) { Write-Host '  Could not add the marketplace.' -ForegroundColor Red; exit 1 }
}

$ok = 0
foreach ($n in $names) {
  Write-Host ('  ◆ {0,-12}' -f $n) -ForegroundColor Magenta -NoNewline
  $out = & claude plugin install "$n@$Market" -s $Scope -y 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Host ' installed' -ForegroundColor Green; $ok++ }
  else { Write-Host " failed: $($out | Select-Object -Last 1)" -ForegroundColor Red }
}

Write-Host ''
Write-Host "  $ok/$($names.Count) mods installed ($Scope scope)." -ForegroundColor Green
Write-Host '  Start a new Claude Code session (or run /reload-plugins), then type /kozmos.' -ForegroundColor Cyan
Write-Host '  Mods are early-access function hooks: Claude Code 2.1.290 or newer.' -ForegroundColor DarkGray

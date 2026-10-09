# Clawdling

A pixel crab companion that lives above the prompt. Its moods follow the session:

| Mood | When | What it does |
| --- | --- | --- |
| lounging | idle | blinks, sways, looks around, smiles now and then |
| scuttling | a tool is running | runs side to side, legs clicking |
| pondering | Claude is thinking | a thought bubble whose dots light up in turn |
| ouch | a tool just failed | frowns, a sweat drop slides down |
| overheating | context over 80 % | sweats and fans itself with a paper fan |
| drowsy | 5-hour limit over 90 % | eyes closed, `z z Z` drifting up |
| celebrating | 5+ answered turns in a row, or a level-up | dances, claws up, sparkles and notes |
| fed & happy | `/clawdling feed` | hearts float up |

It earns XP: +1 per successful tool call, +10 per answered turn. Level *n* needs 100 × *n* XP, and levels unlock
accessories: Lv 3 party hat, Lv 5 sunglasses, Lv 8 scarf, Lv 12 crown. XP is kept across sessions.

Beside the crab: its name, `Lv 4 · 230/400 XP`, a typed-out quip that fits the mood, and a status line.

- **Terminal:** a `Client` surface module draws the 16×8-pixel crab with half blocks (`▀`/`▄`, two pixels per cell) at 8 fps.
- **Desktop:** the same sprite as a 24-frame SVG flipbook (CSS step animation), with sand, bubbles and an XP bar; light and dark aware.

Commands: `/clawdling` shows or hides it, `/clawdling feed`, `/clawdling stats`. The `✕` button hides it too.
Setting: `name` (default `Pinchy`).

## Türkçe

İstemin üstünde yaşayan piksel bir yengeç. Ruh hâli oturumu izler: boşta göz kırpar ve salınır, araç çalışırken
yan yan koşar, düşünürken baloncuk çıkarır, araç hata verince üzülüp terler, bağlam yüzde 80'i geçince
yelpazelenir, 5 saatlik limit yüzde 90'ı geçince uyuklar (`z z Z`), art arda 5 başarılı turda dans eder,
`/clawdling feed` ile beslenince kalpler uçurur.

XP kazanır: başarılı her araç +1, tamamlanan her tur +10. Seviyeler aksesuar açar: Lv 3 parti şapkası,
Lv 5 güneş gözlüğü, Lv 8 atkı, Lv 12 taç. XP oturumlar arasında saklanır.

Terminalde yarım bloklarla 8 fps animasyon (Client modülü), masaüstünde aynı sprite'tan 24 kareli SVG flipbook.
Komutlar: `/clawdling` (göster/gizle), `/clawdling feed`, `/clawdling stats`. Ayar: `name` (varsayılan `Pinchy`).

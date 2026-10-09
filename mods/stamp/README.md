# KOZMOS Stamp

A receipt on every finished turn. The closing line of a main-loop turn
(`Baked for 42s`) becomes one compact row:

```
⏱ 42s · 12 tools $5 ✎4 ◉3 · ↑3.1k ↓8.2k tok · $0.31 · ctx 58% (+4%)
```

- duration as the engine measured it;
- tool calls of the turn, with a colored glyph chip per family (shell, edit, read, search, agents, web, tasks, MCP);
- fresh input tokens (uncached + cache writes) up, output tokens down;
- the turn's cost (the session cost's change across the turn, or an estimate from the turn's usage);
- the context fill at the end of the turn and how much the turn added.

The figures come from `turn.start`, `turn.step` usage, `tool.call` and
`turn.complete`, with `$.session.usage()` read at both ends of the turn.

**How a line finds its turn.** The `TurnDuration` line carries only its word
and `durationMs`. Each main-loop `turn.complete` appends a receipt in order of
completion; a line takes the receipt whose duration is closest to its own
within 1.5 s (or 3 %), the latest winning a tie. A line with no such receipt
(a resumed transcript, a turn from before the mod loaded) keeps the engine's
own text.

`/stamp` toggles it (`/stamp on`, `/stamp off`), remembered across sessions;
`/stamp last` prints the last receipt. On a surface with `Svg` the receipt is
one SVG row with pill chips; today the engine raises this line on the terminal only.

## Türkçe

Her biten turun altına bir fiş. Ana döngüdeki bir turu kapatan satır
(`Baked for 42s`) tek ve kompakt bir satıra dönüşür: süre, aile renkli glif
çipleriyle araç çağrıları, giden/gelen token, turun maliyeti ve bağlam
doluluğu ile turun eklediği pay. Satır, turuna `durationMs` değeriyle
eşleşir (tamamlanma sırasıyla kaydedilen fişlerden en yakın süreli olanı,
1,5 sn / %3 tolerans); eşleşme yoksa motorun kendi metni kalır.
`/stamp` aç/kapa yapar ve tercihi saklar; `/stamp last` son fişi yazar.

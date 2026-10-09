# KOZMOS Mantra

A themed spinner. While a turn runs, the spinner's word rotates every four
seconds through a pack of original gerunds, in an order fixed per turn, and
its tail names what is happening:

```
Slingshotting… · $ npm test 0:12   (12s · 300 tokens)
Raking sand… · ∴ high              (thinking, with the effort)
```

Packs: `cosmic` (Warping, Orbiting, Redshifting…), `zen` (Breathing,
Raking sand, Steeping…), `pirate` (Plundering, Hoisting sails…), `turkish`
(Düşünüyor, Kurcalıyor, Demleniyor…), `hacker` (Grepping, Fuzzing,
Yak-shaving…), 27+ words each.

It rewrites only the `Spinner` props the engine allows (`word`, `suffix`),
so the engine keeps its own animation, timer and token count. On the desktop
the row's own word (`Creating notes.md`) is kept and only the generic
`Working` is themed.

- `/mantra <pack>` switches pack (remembered); the default comes from the
  `pack` option in the plugin's settings.
- `/mantra off` / `/mantra on`; `/mantra` alone toggles.

## Türkçe

Temalı bir spinner. Tur sürerken spinner kelimesi dört saniyede bir, tura
özgü sabit bir sırayla seçilen paketteki özgün fiillerden birine döner; kuyruk
kısmı çalışan aracı ve geçen süresini (`· $ npm test 0:12`), düşünme
modunda ise effort seviyesini gösterir. Paketler: `cosmic`, `zen`, `pirate`,
`turkish` (Düşünüyor, Kurcalıyor, Demleniyor…), `hacker`. Yalnızca motorun
izin verdiği `word` ve `suffix` alanları yeniden yazılır. `/mantra <paket>`
paketi değiştirir, `/mantra off` kapatır.

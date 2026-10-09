# KOZMOS Ballast

A context coach. Ballast watches how full the context window is (the engine's
`session.measure` pushes, plus a reading after every turn):

- at **warnAt** (default 75%) one toast: plan a `/compact` before it fills;
- at **actAt** (default 88%) a band: `⚓ ctx 89% — compact before the next big task`
  with **Compact now** and **Not now**. Compact now runs between turns; pressed
  while a turn runs it is queued and runs when the turn ends. Not now rests the
  band until the fill grows four more points.
- `autoCompact` (default off) compacts by itself at actAt, between turns.
- After every compaction (yours, `/compact`, or the engine's own) a toast shows
  before → after: `⚓ compacted: 890k → 120k tokens (−87%)`.

**Terminal:** the band's first row is the message and its buttons; the second a
waterline gauge `▕~≈~≈~≈…┊··┊·▏` with marks at warnAt and actAt.
**Desktop:** one SVG: a swaying anchor and a tank whose water level is the
context fill, with animated waves and dashed warn / act lines.

`/ballast` hides or shows the band (kept across sessions), `/ballast now`
compacts, `/ballast status` reports the fill and the last compaction.

## Türkçe

Bir bağlam koçu. Ballast bağlam penceresinin doluluğunu izler:

- **warnAt** (varsayılan %75) eşiğinde bir kez bildirim gösterir;
- **actAt** (varsayılan %88) eşiğinde bir bant açar:
  `⚓ ctx 89% — compact before the next big task`, **Compact now** (şimdi
  sıkıştır) ve **Not now** (şimdi değil) düğmeleriyle. Bir tur sürerken
  basılırsa sıkıştırma kuyruğa alınır ve tur bitince çalışır.
- `autoCompact` (varsayılan kapalı) actAt eşiğinde turlar arasında kendiliğinden sıkıştırır.
- Her sıkıştırmadan sonra önce → sonra token sayısını gösteren bir bildirim çıkar.

**Terminal:** mesaj, düğmeler ve uyarı/eylem işaretli bir su çizgisi göstergesi.
**Masaüstü:** sallanan bir çapa ve su seviyesi bağlam doluluğu olan, dalgaları
canlandırılmış bir tank (tek SVG).

`/ballast` bandı gizler/gösterir, `/ballast now` hemen sıkıştırır,
`/ballast status` durumu bildirir.

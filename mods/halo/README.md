# KOZMOS Halo

A one-row mood line across the band whose color and motion say what Claude is doing:

| State | Line |
| --- | --- |
| idle | calm blue, slow breathing |
| requesting / writing | a violet gradient flowing right |
| thinking | a magenta shimmer with sparks |
| a tool running | the tool family's color racing left → right |
| a tool failed | a red flash for 4 s |
| waiting for you (`AskUserQuestion`, `ExitPlanMode` in progress) | an amber blink |

How the state is read: `turn.start` / `turn.complete` say whether a turn runs; the main loop's `turn.step` chunks say requesting, thinking or writing as they stream; `tool.call` says which tool runs and whether it failed. The spinner's own mode comes from a `ui.render` hook on `Spinner`, but a render hook must not write state, so that hook only stores the mode in a module variable and passes the drawing on unchanged; a 400 ms timer and every tool and turn event compute the mood and publish it to `$.state` only when it changed.

Terminal: a `Client` painting `━` at ~30 fps, every cell its own color. Desktop: one SVG line with CSS-animated gradients, glow, a comet or a strobe. Always on, one row.

`/halo` shows or hides it; `✕` hides it. The choice is kept across sessions.

## Türkçe

Bandın boyunca, rengi ve hareketiyle Claude'un ne yaptığını söyleyen tek satırlık bir ruh hâli çizgisi:

| Durum | Çizgi |
| --- | --- |
| boşta | sakin mavi, yavaş nefes |
| istek / yazma | sağa akan mor bir degrade |
| düşünme | kıvılcımlı macenta bir parıltı |
| araç çalışıyor | araç ailesinin rengi soldan sağa koşar |
| araç başarısız | 4 sn kırmızı flaş |
| sizi bekliyor (`AskUserQuestion`, `ExitPlanMode` sürerken) | amber yanıp sönme |

Durum nasıl okunur: `turn.start` / `turn.complete` tur sürüyor mu söyler; ana döngünün `turn.step` parçaları akarken istek, düşünme ya da yazmayı söyler; `tool.call` hangi aracın çalıştığını ve başarısız olup olmadığını söyler. Spinner'ın kendi modu `Spinner` üzerindeki bir `ui.render` kancasından gelir; çizim kancası durum yazamadığı için modu yalnızca bir modül değişkenine koyar ve çizimi olduğu gibi geçirir; 400 ms'lik bir zamanlayıcı ile her araç ve tur olayı ruh hâlini hesaplar ve yalnızca değiştiğinde `$.state`'e yayımlar.

Terminal: `━` karakterlerini ~30 fps boyayan, her hücresi kendi renginde bir `Client`. Masaüstü: CSS ile canlanan degrade, ışıma, kuyruklu yıldız ya da flaşlı tek SVG çizgi. Her zaman açık, tek satır.

`/halo` gösterir veya gizler; `✕` gizler. Seçim oturumlar arasında saklanır.

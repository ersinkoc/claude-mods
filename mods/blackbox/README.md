# KOZMOS Blackbox

A flight recorder above the prompt: a live Gantt chart of the current turn.

- Lane 1 is the main loop, then one lane per subagent (named from its spawn or `$.agent.list()`); the busiest lanes are shown and the rest counted as `+N`.
- Every tool call is a bar from its start to its end, in its tool family's color; failed calls are red; calls that overlap in one lane stack as two half-height bars.
- Every model request is a thin tick where it was sent.
- A pink cursor marks now; the time axis runs to the next round span (5 s, 10 s, 15 s, 20 s, 30 s, 45 s, 1 m …) and rescales as the turn grows.
- When the turn completes the recording stays, dimmed, until the next turn starts.

Terminal: one `Raster` with a label column (an axis row plus up to three lanes, fewer on a short band), repainted by `$.ui.blit` eight times a second while the turn runs, so the cursor and running bars move between events. Desktop: one SVG with up to five lanes; between redraws the cursor glides and running bars grow at the axis' pace with CSS.

`/blackbox` shows or hides it; `✕` hides it. The choice is kept across sessions.

## Türkçe

İstemin üstünde bir uçuş kayıt cihazı: o anki turun canlı Gantt şeması.

- 1. şerit ana döngü, sonra her alt ajan için bir şerit (adı başlatılırken verilen açıklamadan ya da `$.agent.list()`'ten); en hareketli şeritler gösterilir, kalanlar `+N` olarak sayılır.
- Her araç çağrısı başından sonuna bir çubuktur, araç ailesinin renginde; başarısızlar kırmızı; aynı şeritte çakışanlar iki yarım yükseklikte çubuk olarak üst üste durur.
- Her model isteği gönderildiği yerde ince bir çentiktir.
- Pembe bir imleç "şimdi"yi gösterir; zaman ekseni bir sonraki yuvarlak süreye (5 sn, 10 sn, 15 sn, 20 sn, 30 sn, 45 sn, 1 dk …) uzanır ve tur uzadıkça yeniden ölçeklenir.
- Tur bitince kayıt, sonraki tur başlayana kadar soluk olarak kalır.

Terminal: etiket sütunlu tek bir `Raster` (eksen satırı ve en çok üç şerit; kısa bantta daha az), tur sürerken saniyede sekiz kez `$.ui.blit` ile yeniden boyanır; imleç ve süren çubuklar olaylar arasında da ilerler. Masaüstü: en çok beş şeritli tek SVG; yeniden çizimler arasında imleç ve süren çubuklar CSS ile eksenin hızında ilerler.

`/blackbox` gösterir veya gizler; `✕` gizler. Seçim oturumlar arasında saklanır.

# KOZMOS Spectra

The context X-ray, as a sidebar. `/spectra` toggles it; `autoOpen` opens it on start.

It reads `$.session.usage({ breakdown: 'summary' })` (a local estimate: no request leaves) when a main turn completes and when the pane opens, never while drawing, and shows:

- **The breakdown grid** /context draws, as a heatmap: colored cells in a Raster on the terminal (`■` full, `□` partial, `·` free, `░` compaction buffer), SVG squares on the desktop (hover one for its category, tokens and share).
- **Categories ranked**, biggest first, with tokens, % of the window and a bar.
- **Context growth per turn**: the context size at each main `turn.complete`, as a braille graph (terminal) or an area chart with a dotted projection (desktop).
- **Auto-compact forecast:** `auto-compact in ~N turns`, from the least-squares slope of the recent run (the points since the last compaction, up to 7). The threshold is the breakdown's `autoCompactThreshold`; when the engine gives none, Spectra **assumes 95 % of the window** and says so. With auto-compact off, the forecast runs against the whole window.

## Türkçe

Bağlam röntgeni, yan panel olarak. `/spectra` paneli açar/kapatır; `autoOpen` oturum başında açar.

`$.session.usage({ breakdown: 'summary' })` çağrısını (yerel bir tahmin: istek gitmez) ana tur bittiğinde ve panel açıldığında okur, çizim sırasında asla; şunları gösterir:

- /context'in çizdiği **dağılım ızgarası**, ısı haritası olarak: terminalde Raster içinde renkli hücreler, masaüstünde SVG kareler (üzerine gelince kategori, token ve pay).
- Büyükten küçüğe **sıralı kategoriler**: token, pencere yüzdesi ve çubuk.
- **Tur başına bağlam büyümesi**: her ana `turn.complete` anındaki bağlam boyutu; terminalde braille grafik, masaüstünde noktalı projeksiyonlu alan grafiği.
- **Otomatik sıkıştırma tahmini:** son turların (son sıkıştırmadan beri, en çok 7 nokta) en küçük kareler eğiminden `auto-compact in ~N turns`. Eşik, dağılımın `autoCompactThreshold` değeridir; motor vermezse pencerenin **%95'i varsayılır** ve bu belirtilir.

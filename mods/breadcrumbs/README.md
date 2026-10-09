# KOZMOS Breadcrumbs

The session's web trail in a sidebar. Every `WebSearch` (query, how many
results the search reported, the first five hits), every `WebFetch` (domain,
path, HTTP status, size, the final URL after redirects) and every browser-like
MCP tool visit (an `mcp__…` tool called with a `url`) is recorded, from the main
loop and from subagents.

- Grouped by domain, most recent first, each group with a colored two-letter
  monogram badge, visit count, last time, bytes fetched and failures; folds
  with ▾ / ▸.
- Every URL and search hit is a `Link`: click to open it (OSC 8 on the
  terminal, an anchor on the desktop).
- **copy all as Markdown** puts the whole trail on the clipboard as a nested
  list grouped by domain.
- At most 300 steps kept.

`/breadcrumbs` toggles the pane, `/breadcrumbs md` prints the Markdown. Set
`autoOpen` to open it on session start.

## Türkçe

Oturumun web izini kenar çubuğunda gösterir. Her `WebSearch` (sorgu, aramanın
bildirdiği sonuç sayısı, ilk beş sonuç), her `WebFetch` (alan adı, yol, HTTP
durumu, boyut, yönlendirme sonrası son URL) ve tarayıcı benzeri her MCP aracı
ziyareti (`url` ile çağrılan bir `mcp__…` aracı) ana döngüden ve alt ajanlardan
kaydedilir.

- Alan adına göre gruplanır; her grubun renkli iki harfli monogram rozeti,
  ziyaret sayısı, son zamanı, indirilen bayt ve hataları vardır; ▾ / ▸ ile
  katlanır.
- Her URL ve arama sonucu tıklanabilir bir `Link`'tir.
- **copy all as Markdown** tüm izi alan adına göre gruplanmış iç içe bir liste
  olarak panoya kopyalar.
- En fazla 300 adım tutulur.

`/breadcrumbs` paneli açar/kapatır, `/breadcrumbs md` Markdown'ı yazar. Oturum
başında açılması için `autoOpen` ayarını açın.

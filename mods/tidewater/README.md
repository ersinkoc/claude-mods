# KOZMOS Tidewater

The live diff of the current turn, as tides above the prompt. Every file
Claude edits gets its own pool of rolling waves: a **green swell** for the
lines it added, a **red ebb** for the lines it removed, plus file chips and
totals like `+128 −42 · 6 files`. The tide rises at the first edit of a turn
and recedes when you type the next prompt.

- **Terminal**: a Client surface module at ~30 fps. Row 1 rolls `▁▂▃▄▅▆▇█`
  swells per file (width by the size of its change), row 2 hangs `▔▀█` ebbs,
  row 3 carries `≋ +128 −42 · 6 files  ● api.ts +40−12 …`. A file that was just
  edited surges, then settles; the newest chip blinks `◉`.
- **Desktop**: one SVG: a totals panel and a tide pool per file, the green
  swell rising above a dashed waterline and the red ebb sinking below it, both
  rolling by CSS keyframes (phases taken from the clock, so redraws stay
  smooth). Works in light and dark themes.
- **How lines are counted** (no shelling out): on each successful `Edit`,
  `MultiEdit`, `Write` or `NotebookEdit` tool call, Tidewater reads the
  tool's own `structuredPatch` and counts its `+`/`-` lines. When there is
  none it diffs the input: `old_string` vs `new_string` (× occurrences for
  `replace_all`), `Write` content vs the `originalFile` the tool reports (all
  lines added for a new file), notebook `new_source` vs `old_source`. Common
  head and tail lines are trimmed and the middle is diffed by LCS. Subagent
  edits count too; edits held for review (`staged`) do not.
- `✕` or `/tidewater` hides it (remembered); `/tidewater` shows it again and
  reports the turn's totals.

## Türkçe

O anki turun canlı farkı (diff), istemin üstünde gelgit olarak. Claude'un
düzenlediği her dosyanın kendi dalga havuzu olur: eklenen satırlar için **yeşil
kabarma**, silinenler için **kırmızı çekilme**, dosya etiketleri ve
`+128 −42 · 6 files` gibi toplamlar. Gelgit turun ilk düzenlemesiyle yükselir,
bir sonraki istemi yazdığınızda çekilir.

- **Terminal**: ~30 fps çalışan Client modülü; dosya başına `▁▂▃▄▅▆▇█`
  kabarmalar, `▔▀█` çekilmeler ve etiket satırı. Yeni düzenlenen dosya kabarır.
- **Masaüstü**: tek SVG; toplam paneli ve dosya başına bir havuz, CSS ile
  yuvarlanan yeşil/kırmızı dalgalar. Açık/koyu tema uyumlu.
- **Satır sayımı** (kabuk çağrısı yok): aracın kendi `structuredPatch`
  çıktısındaki `+`/`-` satırları; yoksa girdiden: `old_string`/`new_string`,
  `Write` içeriği ile aracın bildirdiği `originalFile`, not defteri
  `new_source`/`old_source`. Ortak baş ve son satırlar atılır, orta kısım LCS
  ile karşılaştırılır.
- `✕` ya da `/tidewater` gizler (hatırlanır); `/tidewater` yeniden gösterir.

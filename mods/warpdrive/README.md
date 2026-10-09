# KOZMOS Warpdrive

A starfield at warp, above the prompt. Stars stream out of the center at the
speed of Claude's **live output token rate**: a slow drift while it thinks,
long hyperspace streaks while it writes. When a main turn ends the ship jumps:
a ring of light, and a line like `⇢ arrived · 42s · 18.4k tok`.

- **Terminal**: a Client surface module at ~30 fps, 3–4 rows of `· ∙ •` stars
  and `─ ═ ╲ ╱ │` streaks colored by depth (far indigo → near white, tinted
  cyan in hyperspace), with a HUD: `▸ WARP 6.2 │ 38 tok/s │ 4.1k tok │ 12s`.
- **Desktop**: one SVG; 72 stars fly radially by CSS keyframes, each star's
  animation delay is taken from the clock so a redraw resumes the flight
  instead of restarting it. Light and dark themes each get their own sky.
- The rate comes from every `turn.step` stream (text, thinking and tool-input
  chunks, ≈ 4 characters a token, measured over 3 s), topped up with the
  request's reported `output_tokens`. Subagents count too.
- Shows while working and for 5 s after the jump; nothing otherwise.
- `✕` or `/warpdrive` hides it (remembered); `/warpdrive` shows it again.

## Türkçe

İstemin üstünde warp hızında bir yıldız alanı. Yıldızlar merkezden dışarı,
Claude'un **canlı çıktı token hızıyla** akar: düşünürken yavaş bir süzülme,
yazarken uzun hiperuzay çizgileri. Ana tur bittiğinde gemi atlar: bir ışık
halkası ve `⇢ arrived · 42s · 18.4k tok` gibi bir satır.

- **Terminal**: ~30 fps çalışan bir Client modülü; derinliğe göre renklenen
  3–4 satır yıldız ve iz, üstünde `▸ WARP 6.2 │ 38 tok/s │ …` göstergesi.
- **Masaüstü**: tek bir SVG; yıldızlar CSS animasyonuyla uçar, gecikmeler
  saatten hesaplandığı için yeniden çizimde akış kesilmez. Açık/koyu tema uyumlu.
- Hız, her `turn.step` akışından (metin, düşünme, araç girdisi; ≈ 4 karakter
  bir token, 3 sn pencere) ve isteğin bildirdiği `output_tokens` değerinden gelir.
- Çalışırken ve atlayıştan sonra 5 sn görünür; başka zaman hiçbir şey çizmez.
- `✕` ya da `/warpdrive` gizler (hatırlanır); `/warpdrive` yeniden gösterir.

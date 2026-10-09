# KOZMOS Lofi

Generative lo-fi music while Claude works. Four original loops, synthesized
from nothing by `tools/make-loops.mjs` (warm detuned chord pads, a two-operator
FM electric piano, a round bass, a soft swung kick / rim / hat pattern with a
gentle side-chain pump, a tape echo, wow and vinyl crackle), each written into
a circular buffer so it loops without a seam:

| mood  | tempo  | length | feel |
| ----- | ------ | ------ | ---- |
| focus | 78 bpm | 12.3 s | ii–V–I–vi in C, keys forward |
| deep  | 68 bpm | 14.1 s | minor ninths, pads, low cutoff |
| night | 62 bpm | 15.5 s | dark sevenths, heavy crackle, long echo |
| sunny | 86 bpm | 11.2 s | bright majors, shaker hats, plucky keys |

- **Opt-in**: nothing plays until `/lofi on` (or the `enabled` setting).
  `/lofi off` stops it; both are remembered.
- **When**: a loop starts with each main turn (`turn.start`) and loops
  (`$.audio.play` with `shouldLoop` and an `AbortSignal`) until the turn
  completes, then stops at once. A clock tick follows the mood when `auto`
  crosses an hour boundary.
- **Mood**: `/lofi mood auto|focus|deep|night|sunny`, or the `mood` setting.
  `auto` picks by local hour: sunny 06–11, focus 11–18, deep 18–22, night after.
  `volume` (0–100) sets the gain.
- **Band** (only while playing): `♪ lofi · deep ▁▃▅▇▅▃` — on the terminal a
  Client surface module whose equalizer bumps on the loop's beat; on the desktop
  one SVG pill whose bars dance by CSS at the loop's tempo. `✕` or bare `/lofi`
  hides / shows the band; `/lofi status` reports.
- Where the engine has no audio player (it says a Linux or Windows terminal
  plays nothing), the first loop ends at once; Lofi then stays quiet for that
  turn instead of retrying, and `/lofi status` says so.
- Regenerate the loops: `node tools/make-loops.mjs` (deterministic; 22.05 kHz
  mono 16-bit WAV, about 2.3 MB in all).

## Türkçe

Claude çalışırken üretken lo-fi müzik. `tools/make-loops.mjs` ile sıfırdan
sentezlenen dört özgün döngü (sıcak akor pad'leri, FM elektrik piyano, yuvarlak
bas, swing'li yumuşak davul, teyp yankısı ve plak cızırtısı); her biri dairesel
bir tampona yazıldığı için dikişsiz döner.

- **İsteğe bağlı**: `/lofi on` demeden hiçbir şey çalmaz; `/lofi off` durdurur.
- **Ne zaman**: her ana turun başında başlar, tur bitene kadar döngüde çalar
  (`shouldLoop` + `AbortSignal`), Claude boşa düşünce hemen durur.
- **Ruh hali**: `/lofi mood auto|focus|deep|night|sunny`; `auto` yerel saate
  göre seçer. `volume` (0–100) ses düzeyidir.
- **Bant** (yalnızca çalarken): `♪ lofi · deep` ve ritme göre zıplayan ekolayzer;
  terminalde Client modülü, masaüstünde CSS ile dans eden SVG. `✕` ya da yalın
  `/lofi` bandı gizler/gösterir.
- Ses çalarının olmadığı yüzeylerde ilk döngü hemen biter; Lofi o tur boyunca
  sessiz kalır, `/lofi status` bunu söyler.

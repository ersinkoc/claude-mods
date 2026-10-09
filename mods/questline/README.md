# KOZMOS Questline

Task progress above the prompt, from the main loop's `TodoWrite` lists and `TaskCreate` / `TaskUpdate` tasks.

- One segmented bar, a segment per task: done green, running violet and pulsing, waiting gray.
- `3/7 · ▶ Running the tests · 1:24`: the count, the running task's `activeForm`, and how long it has run.
- Hidden when there are no tasks, and two minutes after everything is done (first a `✓ Quest complete` with a shine rolling across the bar).

Terminal: a `Client` bar whose running segment breathes with a highlight running through it and whose clock ticks locally. Desktop: one SVG with rounded segments, a glowing, shimmering active segment and check marks on the done ones.

`/questline` shows or hides it; `✕` hides it. The choice is kept across sessions.

## Türkçe

İstemin üstünde görev ilerlemesi; ana döngünün `TodoWrite` listelerinden ve `TaskCreate` / `TaskUpdate` görevlerinden.

- Görev başına bir bölmeli tek çubuk: bitenler yeşil, süren mor ve nabız gibi atan, bekleyenler gri.
- `3/7 · ▶ Running the tests · 1:24`: sayı, süren görevin `activeForm`'u ve ne kadar süredir sürdüğü.
- Görev yokken ve her şey bittikten iki dakika sonra gizlenir (önce çubukta gezinen bir parıltıyla `✓ Quest complete`).

Terminal: süren bölmesi nefes alan ve içinden bir ışık geçen, saati yerelde işleyen bir `Client` çubuğu. Masaüstü: yuvarlak bölmeli, aktif bölmesi parlayıp ışıldayan, bitenlerde onay işareti olan tek SVG.

`/questline` gösterir veya gizler; `✕` gizler. Seçim oturumlar arasında saklanır.

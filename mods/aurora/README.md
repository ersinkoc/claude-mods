# KOZMOS Aurora

Northern lights above the prompt while the model **thinks**.

- Curtains of light hang from the sky with a bright lower edge, green low and violet/rose high, with shimmering rays. Their height, fold and speed follow the **effort level** of the request: `low` is a gentle glow, `max` is wild.
- While the model **responds**: a calmer single cyan ribbon.
- A label: `✦ thinking · xhigh · 12s` with an intensity gauge.
- Nothing while idle or while tools run.

**Terminal:** a Client module, 2–3 rows at 30 fps, drawing curtains with block characters (`▀ ▔` for the lower edge, `▁▂▃…` for the top, `▓▒░` for the rays). **Desktop:** one SVG night sky with blurred gradient curtain bands that drift, flare and breathe by CSS (speed from effort, phase kept across redraws), and twinkling stars.

**How it knows the model is thinking.** A `ui.render` hook may not write state, so the band does not rely on the Spinner alone. The primary signal is the **`turn.step` stream** of the main loop: a `thinking` chunk means thinking, a `text` chunk responding, a `tool`/`input` chunk tool input; the step's start is `requesting` and its end `tool-use` or idle. `turn.step` also carries the `effort`. A `ui.render` hook on the **Spinner** reads `e.props.mode` into a module variable only (it writes nothing), and a 500 ms timer adopts that mode when it changed during a turn, covering what the stream does not show.

`✕` hides it; `/aurora` toggles it.

## Türkçe

Model **düşünürken** istem satırının üstünde kuzey ışıkları.

- Parlak alt kenarlı ışık perdeleri gökten sarkar; altta yeşil, üstte mor/pembe, titreşen ışınlarla. Yükseklikleri, kıvrımları ve hızları isteğin **çaba düzeyini** izler: `low` yumuşak bir parıltı, `max` çılgın.
- Model **yanıt verirken**: daha sakin, tek bir camgöbeği şerit.
- Etiket: `✦ thinking · xhigh · 12s` ve bir yoğunluk göstergesi.
- Boştayken ya da araçlar çalışırken hiçbir şey çizmez.

**Terminal:** blok karakterlerle perde çizen 2–3 satırlık, 30 fps Client modülü. **Masaüstü:** CSS ile süzülen, parlayan ve nefes alan bulanık perdelerle tek bir SVG gece göğü.

**Düşündüğünü nasıl anlar?** Asıl sinyal ana döngünün **`turn.step` akışıdır**: `thinking` parçası düşünme, `text` yanıt, `tool`/`input` araç girdisi demektir; çaba da `turn.step`ten okunur. **Spinner** üzerindeki `ui.render` kancası `e.props.mode` değerini yalnızca bir modül değişkenine okur (durum yazmaz); 500 ms'lik zamanlayıcı bu modu tur sırasında değiştiyse benimser.

`✕` gizler; `/aurora` açar/kapatır.

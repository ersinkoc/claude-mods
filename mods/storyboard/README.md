# KOZMOS Storyboard

Claude narrates its own progress. Storyboard registers a tool the model can
call, `mcp__storyboard__chapter { title, phase, step?, steps?, note? }`, and
adds one short line to the system prompt asking Claude to call it whenever its
phase changes on a multi-step task. Each call becomes a chapter.

- **Band above the prompt:** the chapter title, step `3/5` with a small meter,
  a five-stage rail (explore → plan → build → verify → ship) with the active
  stage lit, and the note. On the desktop the rail is one SVG with a glowing
  node, a pulsing halo and a comet orbiting the active stage; on the terminal
  it is a colored rail. The band stacks under the other mods' bands and hides
  with its `✕` or `/storyboard` (remembered between sessions).
- **Chapter log pane:** `/storyboard log` opens the history of chapters with
  times, phase chips and notes, plus a time-per-phase bar.
  `/storyboard list` prints the log as text.

Settings (`userConfig`): `nudge` (default on) adds the prompt line; turn it
off to keep the prompt untouched and let Claude find the tool on its own.
`autoOpen` (default off) opens the log pane at start.

## Türkçe

Claude kendi ilerlemesini anlatır. Storyboard modelin çağırabileceği bir araç
kaydeder (`mcp__storyboard__chapter { title, phase, step?, steps?, note? }`)
ve sistem istemine, çok adımlı işlerde her evre değişiminde bu aracı çağırmasını
isteyen tek kısa satır ekler. Her çağrı bir bölüm olur.

- **İstem üstü bant:** bölüm başlığı, `3/5` adımı ve küçük bir ölçer, beş
  evreli ray (explore → plan → build → verify → ship) ve not. Masaüstünde ray,
  etkin evrenin etrafında dönen bir kuyruklu yıldızla parlayan tek bir SVG;
  terminalde renkli bir ray. Diğer modların bantlarının altına dizilir; `✕` ya da
  `/storyboard` ile gizlenir (oturumlar arasında hatırlanır).
- **Bölüm günlüğü paneli:** `/storyboard log` zamanları, evre etiketleri ve
  notlarıyla bölüm geçmişini ve evre başına süre çubuğunu açar.
  `/storyboard list` günlüğü metin olarak yazar.

Ayarlar: `nudge` (varsayılan açık) istem satırını ekler; kapatılırsa istem
değişmez. `autoOpen` (varsayılan kapalı) günlük panelini açılışta açar.

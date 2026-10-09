# KOZMOS Hivemind

The agent swarm as a live tree in a sidebar. `◆ main` sits at the root and
every subagent hangs under the loop that spawned it.

Each node shows:

- a status glyph: a spinning `◐◓◑◒` while it runs, `✓` done, `✖` failed, `⏸` waiting or idle
- the subagent type and its task description (`⇢bg` for background agents)
- model and effort, elapsed time, requests made, tokens and an estimated spend
- the context fill of its last request as a small bar
- the tool it runs now (with its detail and a timer) or the last one it ran

The header counts running, done and failed agents, totals their estimated
spend, tokens and requests, and draws a sparkline of how many ran at once.
`▾ hide finished` (hotkey `f`) folds away finished branches.

On the desktop the header is a row of tiles with an activity area chart, and
the tree is one SVG with connector lines (flowing while a child runs), pulsing
halos, spinning arcs and mini context bars. Light and dark themes both work.

- `/hivemind` toggles the sidebar.
- `autoOpen` (default off) opens it when a session starts.

Estimated spend uses list prices per model; the session total is the engine's
and lives in KOZMOS Bridge.

## Türkçe

Ajan sürüsünü kenar çubuğunda canlı bir ağaç olarak gösterir. Kökte `◆ main`
durur, her alt ajan onu başlatan döngünün altına asılır.

Her düğümde şunlar var:

- durum simgesi: çalışırken dönen `◐◓◑◒`, bitince `✓`, hata olursa `✖`, beklerken `⏸`
- alt ajan türü ve görev açıklaması (arka plandakiler için `⇢bg`)
- model ve effort, geçen süre, istek sayısı, token ve tahmini maliyet
- son isteğin bağlam doluluğu, küçük bir çubuk olarak
- şu an çalıştırdığı araç (ayrıntısı ve sayacıyla) ya da son çalıştırdığı

Başlık çalışan, biten ve başarısız ajanları sayar, tahmini maliyetlerini,
token ve isteklerini toplar, aynı anda kaç ajan çalıştığını bir kıvılcım
grafiğiyle çizer. `▾ hide finished` (kısayol `f`) biten dalları katlar.

Masaüstünde başlık bir kutucuk sırası ve etkinlik grafiğidir; ağaç bağlantı
çizgileri (çocuk çalışırken akan), nabız gibi atan halkalar, dönen yaylar ve
küçük bağlam çubuklarıyla tek bir SVG'dir. Açık ve koyu temada çalışır.

- `/hivemind` kenar çubuğunu açar/kapatır.
- `autoOpen` (varsayılan kapalı) oturum başlarken açar.

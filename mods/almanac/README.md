# KOZMOS Almanac

What this session is made of, in one pane.

Almanac keeps a ledger as the session runs and shows each part with how often
it was used and when it first appeared (time since the session began):

- **Commands:** every slash command run, ranked.
- **Skills:** every skill the model invoked with the Skill tool, as a tag cloud.
- **Subagents:** the agent types spawned, ranked.
- **MCP servers:** the servers whose `mcp__<server>__…` tools were called.
- **Models:** each model seen on a request, with its request count.
- **Plugins:** plugins whose tools (or agent types) were used.
- **Tool families:** shell, edit, read, search, agent, web, tasks, skill, mcp,
  as one stacked bar with a legend.

The header carries the Claude Code version, the session's age, totals, and how
many installed slash commands this session never ran. On the desktop each
section is one SVG (ranked bars, pill clouds sized by use, light and dark
aware); on the terminal they are colored bars and wrapped tag clouds.

`/almanac` toggles the pane, `/almanac print` writes the ledger as text.
`autoOpen` (default off) opens it at start.

## Türkçe

Bu oturumun nelerden oluştuğu, tek bir panelde.

Almanac oturum boyunca bir defter tutar ve her parçayı ne sıklıkla
kullanıldığı ve ilk ne zaman göründüğüyle (oturumun başından beri geçen süre)
gösterir: çalıştırılan eğik çizgi komutları, Skill aracıyla çağrılan beceriler
(etiket bulutu), başlatılan alt ajan türleri, araçları çağrılan MCP sunucuları,
görülen modeller ve istek sayıları, araçları kullanılan eklentiler ve araç
aileleri (tek yığılmış çubuk ve açıklama).

Başlıkta Claude Code sürümü, oturumun yaşı, toplamlar ve bu oturumda hiç
çalıştırılmayan kurulu komut sayısı yer alır. Masaüstünde her bölüm tek bir
SVG'dir (açık ve koyu temaya uyar); terminalde renkli çubuklar ve sarılan
etiket bulutlarıdır.

`/almanac` paneli açıp kapatır, `/almanac print` defteri metin olarak yazar.
`autoOpen` (varsayılan kapalı) paneli açılışta açar.

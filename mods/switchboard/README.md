# KOZMOS Switchboard

An MCP observatory sidebar. Switchboard reads the session's tool list
(`$.tool.list()`, every 30 s) and times every `mcp__<server>__<tool>` call made
by Claude or a subagent. For each server:

- tools available now, calls, errors, average and p95 latency;
- the last call (how long ago, which tool) and the last error;
- a status lamp: **healthy** (called in the last 5 min, last call fine),
  **erroring** (the last call failed, or two of the last five), **busy** (a call
  is running), **idle** (no recent calls);
- servers in the tool list with zero calls show too; expand a server for its
  per-tool rows.

An erroring server has a **reconnect** button. It calls `$.mcp.connect`, which
the engine only allows for servers a plugin's own manifest lists; for your own
servers it says so and points to `/mcp`.

- **Terminal:** a header, then two rows per server (lamp, name, status; the
  figures) with ▸/▾ to open its tools.
- **Desktop:** a patch bay: a CLAUDE jack with glowing cables to every server
  that has been called, sockets for the idle ones, a dashed current running
  along the cables of servers in use; then one card per server.
- `/switchboard` opens or closes the sidebar; `/switchboard list` prints the
  table. `autoOpen` (default off) opens it at start.

## Türkçe

Bir MCP gözlem kenar çubuğu. Switchboard oturumun araç listesini okur ve
Claude ya da bir alt ajanın yaptığı her `mcp__<sunucu>__<araç>` çağrısını
zamanlar. Her sunucu için: kullanılabilir araçlar, çağrılar, hatalar, ortalama
ve p95 gecikme, son çağrı ve son hata, ve bir durum lambası (**healthy**,
**erroring**, **busy**, **idle**). Hiç çağrılmamış sunucular da görünür;
genişletince araç bazında satırlar açılır.

Hata veren sunucuda bir **reconnect** düğmesi vardır; motor yalnızca bir
eklentinin kendi manifestinde listelenen sunuculara yeniden bağlanmaya izin
verdiği için, kendi sunucularınızda `/mcp` komutunu önerir.

- **Terminal:** başlık ve sunucu başına iki satır, araçlar için ▸/▾.
- **Masaüstü:** CLAUDE jakından kullanılan sunuculara parlayan kablolarla bir
  bağlantı paneli (patch bay) ve sunucu kartları.
- `/switchboard` kenar çubuğunu açar/kapatır; `/switchboard list` tabloyu yazdırır.

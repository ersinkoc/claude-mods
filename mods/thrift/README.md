# KOZMOS Thrift

A frugal mode for tight limits. `/thrift on|off|auto` (kept across sessions).
While thrift is on, every prompt carries a short note beside it — never in it —
asking Claude to be economical:

> Thrift mode is on: usage limits are tight. Be economical: prefer targeted
> reads (specific files, line ranges) over broad searches, avoid subagents
> unless clearly needed, do not re-read what you already have, and keep
> answers concise.

`auto` turns thrift on by itself when the 5-hour or weekly limit passes
`autoAt` (default 90%) and off again once that window resets.

Thrift counts the cost of every turn (each model request's usage, subagents
included, priced with KOZMOS's table) as a thrift turn or a normal turn;
`/thrift` alone prints both averages and how much less a thrift turn costs.

- **Terminal:** a band `🪙 thrift on · 5h 92% · saving mode` with a coin
  spinning on its edge (a Client surface module) and ✕.
- **Desktop:** one SVG: a gold coin flipping, the limit window's gauge with the
  autoAt mark, and the saving so far.
- `/thrift hide|show` toggles the band; thrift's mode stays as it is.

The `prompt.submit` hook is an observer plus a rewrite of `context` only; its
`.catch` passes the prompt through unchanged, so thrift can never block one.

## Türkçe

Sıkı limitler için tutumlu mod. `/thrift on|off|auto` (oturumlar arasında
saklanır). Thrift açıkken her istemin yanına — içine değil — Claude'dan tutumlu
olmasını isteyen kısa bir not eklenir: hedefli okumalar, geniş aramalardan ve
gerekmedikçe alt ajanlardan kaçınma, kısa yanıtlar.

`auto`, 5 saatlik ya da haftalık limit `autoAt` (varsayılan %90) eşiğini
geçince thrift'i kendiliğinden açar, pencere sıfırlanınca kapatır.

Thrift her turun maliyetini (alt ajanlar dahil) thrift turu ya da normal tur
olarak sayar; `/thrift` iki ortalamayı ve thrift turlarının ne kadar ucuz
olduğunu gösterir.

- **Terminal:** dönen bir madeni para ile `🪙 thrift on · 5h 92% · saving mode` bandı.
- **Masaüstü:** dönen altın para, limit göstergesi ve tasarruf (tek SVG).
- `/thrift hide|show` bandı gizler/gösterir.

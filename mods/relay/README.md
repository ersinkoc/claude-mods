# KOZMOS Relay

The API latency lab in a sidebar. Every model request (`turn.step`) of the main
loop and of subagents is timed from the start of the step to its result, with
the time to its first streamed chunk, and read for its model, effort,
input / output / cache-read / cache-write tokens, output tokens per second
(over the streaming part) and stop reason.

- Header: p50 and p95 latency, average tokens/sec, average time to first
  token, overall cache-read share, tokens in and out.
- Latency histogram (<1 s … 64 s+), vertical bars on the terminal, a column
  chart on the desktop.
- Tokens/sec over time: a braille graph on the terminal, an SVG area line on
  the desktop.
- Model mix as a stacked bar with a legend, cache-read share per request,
  the slowest five requests and the last twelve with all their numbers.
- At most 300 requests kept; requests that got no response are counted.

`/relay` toggles the pane, `/relay stats` prints the numbers. Set `autoOpen`
to open it on session start.

## Türkçe

Kenar çubuğunda API gecikme laboratuvarı. Ana döngünün ve alt ajanların her
model isteği (`turn.step`), adımın başından sonucuna kadar ve ilk akış
parçasına kadar geçen süreyle ölçülür; modeli, efor düzeyi, girdi / çıktı /
önbellek okuma / önbellek yazma token'ları, saniyedeki çıktı token'ı (akış
kısmı üzerinden) ve durma nedeni okunur.

- Başlık: p50 ve p95 gecikme, ortalama token/sn, ilk token'a kadar ortalama
  süre, genel önbellek okuma payı, giren ve çıkan token.
- Gecikme histogramı (<1 sn … 64 sn+): terminalde dikey çubuklar, masaüstünde
  sütun grafiği.
- Zaman içinde token/sn: terminalde braille grafik, masaüstünde SVG alan
  çizgisi.
- Lejantlı yığılmış çubukla model karışımı, istek başına önbellek okuma payı,
  en yavaş beş istek ve tüm sayılarıyla son on iki istek.
- En fazla 300 istek tutulur; yanıt alamayan istekler sayılır.

`/relay` paneli açar/kapatır, `/relay stats` sayıları yazar. Oturum başında
açılması için `autoOpen` ayarını açın.

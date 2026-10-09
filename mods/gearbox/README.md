# KOZMOS Gearbox

Tool analytics for the session in a sidebar. Every tool call is timed, by the
main loop and by subagents alike.

- Per tool: calls, errors and error rate, average, p95 and max duration, and
  total time, with a bar in the tool's family color.
- A sort button (hotkey `s`) cycles the order and the bars between total time,
  calls and errors.
- The five slowest calls with their detail (the command, the file, the
  pattern) and which subagent made them.
- Calls per minute over the session (up to two hours) as a braille graph.
- Main loop against subagents: a split bar of calls, with their tool time.

Terminal: an aligned table with bars (average and max columns from 58 columns
wide). Desktop: header tiles, a calls-per-minute area chart, an SVG bar chart
whose bars grow in and show the errored share in red, and a ranked list of the
slowest calls.

- `/gearbox` toggles the sidebar; `autoOpen` (default off) opens it at start.

## Türkçe

Oturumun araç analizini kenar çubuğunda gösterir. Ana döngünün de alt
ajanların da her araç çağrısı ölçülür.

- Araç başına: çağrı, hata ve hata oranı, ortalama, p95 ve en uzun süre, toplam
  süre; aracın ailesinin renginde bir çubukla.
- Sıralama düğmesi (kısayol `s`) sırayı ve çubukları toplam süre, çağrı ve
  hata arasında döndürür.
- En yavaş beş çağrı; ayrıntısı (komut, dosya, desen) ve yapan alt ajanla.
- Oturum boyunca dakika başına çağrı (en fazla iki saat), braille grafik olarak.
- Ana döngü ve alt ajanlar: çağrıları bölen bir çubuk ve araç süreleri.

Terminal: çubuklu, hizalı bir tablo (58 sütundan genişte ortalama ve en uzun
sütunlarıyla). Masaüstü: başlık kutucukları, dakika başına çağrı alan
grafiği, büyüyerek gelen ve hatalı payı kırmızı gösteren SVG çubuk grafik ve
en yavaş çağrıların sıralı listesi.

- `/gearbox` kenar çubuğunu açar/kapatır; `autoOpen` (varsayılan kapalı)
  başlangıçta açar.

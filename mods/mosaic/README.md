# KOZMOS Mosaic

A GitHub-style activity calendar across sessions, as a sidebar. `/mosaic` toggles it; `autoOpen` opens it on start.

Per local day it keeps in `$.store`: sessions started, main turns, tool calls (subagents included), tokens (every `turn.step` usage), dollars (the growth of each session's cost) and active minutes (a minute counts once when anything happened in it or Claude was working). Counts are buffered and written every 10 seconds; days older than 200 are pruned.

The pane draws 26 weeks × 7 days (Sunday first) colored by the selected metric in four quartile levels. Buttons (hotkeys 1 to 4) switch the metric: turns, tools, tokens, $. Below: the current streak (an empty today keeps yesterday's run alive), the longest streak, the best day, 26-week totals and today's line. Terminal: colored `■` cells in a Raster with month and weekday labels. Desktop: rounded SVG squares with tooltips (title elements), today ringed, the busiest days gently breathing, plus stat tiles and today's figures.

## Türkçe

Oturumlar arası GitHub tarzı etkinlik takvimi, yan panel olarak. `/mosaic` paneli açar/kapatır; `autoOpen` oturum başında açar.

Her yerel gün için `$.store` içinde tutar: başlatılan oturumlar, ana turlar, araç çağrıları (alt ajanlar dahil), tokenlar (her `turn.step` kullanımı), dolar (her oturumun maliyet artışı) ve aktif dakikalar. Sayımlar biriktirilip 10 saniyede bir yazılır; 200 günden eski günler silinir.

Panel, seçili metriğe göre dört çeyreklik seviyede renklenen 26 hafta × 7 gün çizer. Butonlar (kısayol 1 ile 4) metriği değiştirir: turns, tools, tokens, $. Altında: güncel seri (bugün boşsa dünkü seri sürer), en uzun seri, en iyi gün, 26 haftalık toplamlar ve bugünün satırı. Terminal: Raster içinde ay ve gün etiketli renkli `■` hücreler. Masaüstü: ipuçlu yuvarlak SVG kareler, halkalı bugün, istatistik kutuları ve bugünün rakamları.

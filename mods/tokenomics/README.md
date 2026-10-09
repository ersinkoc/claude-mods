# KOZMOS Tokenomics

The cost lab, as a sidebar. `/tokenomics` toggles it; set `autoOpen` to open it on start.

- **Headline:** the session cost the engine reports (`$.session.usage().cost`), the burn per hour (last 30 minutes, else the session average) and "at this pace: next hour ≈ $X".
- **By model and by token type:** every `turn.step` response (main loop and subagents) priced with the KOZMOS price table: input, output, cache read, cache write. This split is an *estimate*; the headline is the engine's figure.
- **Cache hit ratio:** cache reads ÷ all input tokens (uncached + cache read + cache write).
- **Cost per turn:** a sparkline of each main turn's cost.
- **Days and weeks:** the growth of each session's cost is booked into the local day in `$.store` (days older than 60 are pruned) and drawn as a 14-day bar chart with today, 7-day and 14-day totals.

Terminal: colored rows with eighth-block bars, a sparkline and the 14-day chart in a Raster. Desktop: four SVG cards: the headline with a cost-per-turn area chart, a donut by model, a stacked bar by token type with the cache-hit gauge, and the daily bars (hover a bar for its date and amount).

## Türkçe

Maliyet laboratuvarı, yan panel olarak. `/tokenomics` paneli açar/kapatır; `autoOpen` ile oturum başında açılır.

- **Manşet:** motorun bildirdiği oturum maliyeti (`$.session.usage().cost`), saatlik yakım (son 30 dakika, yoksa oturum ortalaması) ve "bu hızla: sonraki saat ≈ $X".
- **Modele ve token türüne göre:** her `turn.step` yanıtı (ana döngü ve alt ajanlar) KOZMOS fiyat tablosuyla fiyatlanır: girdi, çıktı, önbellek okuma, önbellek yazma. Bu dağılım bir *tahmindir*; manşet motorun rakamıdır.
- **Önbellek isabet oranı:** önbellek okumaları ÷ tüm girdi tokenları.
- **Tur başına maliyet:** her ana turun maliyetinin kıvılcım grafiği.
- **Gün ve hafta:** her oturumun maliyet artışı yerel güne `$.store` içinde işlenir (60 günden eskiler silinir); bugün, 7 ve 14 günlük toplamlarla 14 günlük çubuk grafik çizilir.

Terminal: renkli satırlar, sekizlik blok çubuklar, kıvılcım grafiği ve Raster içinde 14 günlük grafik. Masaüstü: dört SVG kart: tur başı maliyet grafikli manşet, modele göre halka grafik, token türüne göre yığılmış çubuk ve önbellek göstergesi, günlük çubuklar.

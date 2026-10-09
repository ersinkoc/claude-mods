# KOZMOS Hourglass

The limit oracle, as a sidebar. `/hourglass` toggles it; `autoOpen` opens it on start; `statusLine` pins `⏳ 5h 42% · 7d 18%` under the prompt.

For each rate-limit window the engine reports (`five_hour`, `seven_day`, a gateway's `spend_limit`), read from `$.session.usage()` and the `session.measure` hook:

- **% used** and the **reset countdown**.
- **Burn rate** in percentage points per hour, measured from timestamped samples kept in `$.store`, so it keeps learning across sessions inside the same window (5-hour window: the last 90 minutes; the others: the last 24 hours). Until the samples span 10 minutes it falls back to the window's average since it began.
- **Reset detection:** a lower percent or a moved `resetsAt` starts the window's memory over.
- **ETA to 100 %** and a **verdict**: `✓ safe — resets 1h40m before you run dry` or `⚠ dry in 52m, 38m before reset`.
- **Toasts** once per window at 80 % and 95 %.

With no windows (an API key, no subscription) it says so kindly. Terminal: a small half-block hourglass per window in a Raster, a bar, a sparkline and the verdict. Desktop: an SVG hourglass per window whose sand matches the percentage, with sand falling while Claude works.

## Türkçe

Limit kâhini, yan panel olarak. `/hourglass` paneli açar/kapatır; `autoOpen` oturum başında açar; `statusLine` istemin altına `⏳ 5h 42% · 7d 18%` satırını sabitler.

Motorun bildirdiği her limit penceresi için (`five_hour`, `seven_day`, ağ geçidi `spend_limit`), `$.session.usage()` ve `session.measure` kancasından:

- **Kullanım yüzdesi** ve **sıfırlanma geri sayımı**.
- **Yakım hızı** (saatte yüzde puan): `$.store` içinde zaman damgalı örneklerden ölçülür, böylece aynı pencerede oturumlar arasında öğrenmeye devam eder. Örnekler 10 dakikayı kapsayana kadar pencerenin başından beri ortalamaya döner.
- **Sıfırlanma tespiti:** yüzde düşerse ya da `resetsAt` değişirse pencere hafızası sıfırlanır.
- **%100'e kalan süre** ve bir **hüküm**: `✓ safe — resets 1h40m before you run dry` ya da `⚠ dry in 52m, 38m before reset`.
- Her pencerede %80 ve %95'te birer kez **bildirim**.

Pencere yoksa (API anahtarı, abonelik yok) bunu nazikçe söyler. Terminal: her pencere için Raster içinde küçük bir kum saati, çubuk, kıvılcım grafiği ve hüküm. Masaüstü: kumu yüzdeye göre dolan SVG kum saati; Claude çalışırken kum akar.

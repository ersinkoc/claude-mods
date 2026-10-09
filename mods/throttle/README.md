# KOZMOS Throttle

A car dashboard above the prompt, shown while Claude works and for a minute after.

- **Speedometer**: output tokens per second over the last ~10 s, main loop and subagents together. Streamed text gives a live estimate; each response's `usage.output_tokens` replaces it when the response ends. The scale grows 100 → 200 → 400 … with the peak of the last minute.
- **Fuel**: what is left of the 5-hour limit (hidden without rate limits).
- **Temperature**: context fill.
- **Odometer**: the session's dollars.
- **Lamps**: check-engine (amber) for 30 s after a failed tool, fuel under 15 %, overheat over 85 % context.

Terminal: three braille dials whose needles ease to each reading and shiver while the engine runs, a counting odometer and lamp chips (a `Client` at ~30 fps). Desktop: one SVG with analog dials (needles and arcs sweep from the previous reading), rolling odometer wheels, glowing lamps and a little car on a road that scrolls with the speed.

`/throttle` shows or hides it; `✕` hides it. The choice is kept across sessions.

## Türkçe

İstemin üstünde bir araba göstergesi; Claude çalışırken ve bittikten sonra bir dakika görünür.

- **Hız göstergesi**: son ~10 saniyede saniye başına çıktı token'ı (ana döngü ve alt ajanlar birlikte). Akan metin canlı bir tahmin verir; yanıt bitince `usage.output_tokens` gerçek sayıyı yazar. Ölçek son dakikanın tepesine göre 100 → 200 → 400 … büyür.
- **Yakıt**: 5 saatlik limitten kalan (oran limiti yoksa gizli).
- **Sıcaklık**: bağlam doluluğu.
- **Kilometre sayacı**: oturumun dolar tutarı.
- **Uyarı lambaları**: başarısız bir araçtan sonra 30 sn motor arızası (amber), yakıt %15 altı, bağlam %85 üstü aşırı ısınma.

Terminal: iğneleri her okumaya yumuşakça giden ve motor çalışırken titreyen üç braille kadran, sayan kilometre sayacı ve lamba etiketleri (~30 fps `Client`). Masaüstü: tek SVG; analog kadranlar (iğneler önceki okumadan süpürülür), dönen sayaç çarkları, parlayan lambalar ve hıza göre kayan bir yolda küçük bir araba.

`/throttle` gösterir veya gizler; `✕` gizler. Seçim oturumlar arasında saklanır.

# KOZMOS Orrery

Subagents as planets circling a central sun (the main Claude), drawn above the prompt.

- **Running** agents orbit on dotted ellipses; the lane follows spawn order and the **angular speed follows the agent's output tokens per second** (from `turn.step` usage), so a streaming agent whirls and a waiting one crawls. Each planet trails a comet tail; its glyph says its type (◍ explore, ◆ plan, ◈ review, ● other).
- **Finished** agents settle as faint dots on the outer ring; **failed** ones flash a red `✖`, then dim.
- The **sun** flickers, and its corona breathes faster while the main loop streams.
- A legend lists up to four agents: glyph, description (clipped), type, elapsed time and tokens/s.

**Terminal:** a Client module draws a 4–5 row orbit field in braille with colored planets at 30 fps, legend beside it. **Desktop:** one SVG night sky: CSS-rotated orbit lanes (each lane's period from the agent's speed, its phase kept across redraws), a pulsing radial-gradient sun, twinkling stars and a theme-aware legend.

Hidden until the first subagent of the session; it stays while any agent runs and for 5 minutes after the last one finished. `✕` hides it; `/orrery` toggles it.

Data: `agent.spawn` (description, type, model → agentId), `turn.step` (usage per `agentId`), `turn.complete` (reason), and `$.agent.list()` every 2 s to reconcile status.

## Türkçe

Alt ajanlar, merkezdeki güneşin (ana Claude) etrafında dönen gezegenler olarak istem satırının üstünde.

- **Çalışan** ajanlar noktalı elipslerde döner; yörünge doğuş sırasını, **açısal hız ise ajanın saniyedeki çıktı token'ını** izler: akış hâlindeki ajan hızla döner, bekleyen ağır ağır ilerler. Her gezegenin kuyruklu yıldız izi vardır; simgesi türünü söyler.
- **Biten** ajanlar dış halkada soluk noktalara dönüşür; **başarısız** olanlar kırmızı `✖` ile yanıp söner, sonra solar.
- Ana döngü akarken **güneş** titrer ve tacı daha hızlı nefes alır.
- Açıklama: en çok dört ajan; simge, açıklama, tür, geçen süre ve token/sn.

**Terminal:** 4–5 satırlık braille yörünge alanı, 30 fps. **Masaüstü:** CSS ile döndürülen yörüngeler, nabız atan güneş ve parıldayan yıldızlarla tek bir SVG gece göğü.

Oturumun ilk alt ajanına kadar gizlidir; bir ajan çalıştıkça ve sonuncusu bittikten sonra 5 dakika görünür. `✕` gizler; `/orrery` açar/kapatır.

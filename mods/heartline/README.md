# KOZMOS Heartline

A neon EKG of the session, drawn above the prompt.

- Every **tool call** is a sharp spike colored by its tool family (Bash green, Edit yellow, Read/Grep blue, Agent violet, Web cyan, MCP magenta).
- Every **model request** is a smaller blip (cyan on the main loop, violet in a subagent).
- A **failed tool** adds a red inverted spike.
- Idle, the line runs flat with a slow breathing glow.
- The trace drifts **green → yellow → red** as the context fills.
- Readout: `♥ 42 bpm` (tool calls in the last minute; the heart beats at that rate), `ctx 58%`, model requests per minute.

**Terminal:** a Client module draws a 2–3 row braille trace that scrolls left continuously at 30 fps, with a phosphor fade on the old side. **Desktop:** one SVG monitor screen with a glowing (blurred) trace on a scrolling grid, a pulsing pen and a beating heart, all CSS-animated.

The band shows while the session had any activity in the last 10 minutes. `✕` hides it; `/heartline` toggles it (remembered across sessions).

## Türkçe

Oturumun neon EKG'si, istem satırının üstünde.

- Her **araç çağrısı**, araç ailesinin rengiyle keskin bir tepe çizer (Bash yeşil, Edit sarı, Read/Grep mavi, Agent mor, Web camgöbeği, MCP pembe).
- Her **model isteği** daha küçük bir kıpırtıdır (ana döngüde camgöbeği, alt ajanda mor).
- **Başarısız bir araç** kırmızı, ters bir tepe ekler.
- Boştayken çizgi düz akar ve yavaşça "nefes alır".
- Bağlam doldukça iz **yeşilden sarıya, sonra kırmızıya** kayar.
- Gösterge: `♥ 42 bpm` (son bir dakikadaki araç çağrısı; kalp bu hızda atar), `ctx 58%`, dakikadaki model isteği.

**Terminal:** Client modülü 2–3 satırlık braille izini 30 fps ile sürekli sola kaydırır. **Masaüstü:** parlayan izli, kayan ızgaralı, CSS ile canlandırılmış tek bir SVG monitör.

Son 10 dakikada etkinlik olduğu sürece görünür. `✕` gizler; `/heartline` açar/kapatır (oturumlar arası hatırlanır).

# Resonance

A soundscape for the session, made of short clips synthesized from sines, FM pairs and noise
(`tools/make-sounds.mjs`, run with Node 22.18+, writes `sounds/*.wav`: 16-bit mono, 22.05 kHz).

| Sound | Plays when |
| --- | --- |
| `tick` | a tool call succeeds (at most one per 400 ms) |
| `bonk` | a tool call fails |
| `chime` | the first turn of the session ends: a rising arpeggio |
| `gong` | a main turn that took more than 20 s ends |
| `bell` | a subagent finishes |
| `alarm` | a rate-limit window crosses 80 % or 95 % (once per crossing, with a toast) |

Settings: `profile`: `subtle` (no ticks, the default), `arcade` (everything) or `silent`; `volume` 0–100.
`/resonance` mutes or unmutes (kept across sessions); `/resonance play <sound>`, `/resonance demo`, `/resonance status`.
Clips play through `$.audio.play({ asset })`, which the engine hands to the platform player (macOS `afplay`; a
Windows or Linux terminal has none, so there it stays quiet).

## Türkçe

Oturum için sentezlenmiş kısa seslerden bir ses manzarası: başarılı araçta tık, hatada "bonk", ilk turda zil
arpeji, 20 saniyeden uzun turda gong, alt ajan bitince çan, kullanım limiti yüzde 80 veya 95'i geçince alarm.
`profile` ayarı (`subtle` / `arcade` / `silent`) ve `volume` (0–100). `/resonance` sesi kapatıp açar. Sesler
`tools/make-sounds.mjs` ile üretilir.

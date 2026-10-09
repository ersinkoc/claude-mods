# KOZMOS Toolmarks

Small badges on tool rows in the transcript, at the right end of the row the
engine draws (its own drawing is kept and composed, never replaced):

```
● Bash(npm test)                                   $ exit 0 · 1.2s
● Read(src/app.ts)                                            ◉ 8ms
● Bash(false)                                       ✖ exit 2 · 0.4s
  Read 3 files, searched 2 patterns                        Σ 0.9s
```

- a family-colored glyph and the call's duration (amber from 3 s);
- for Bash / PowerShell, the exit status (from the error text when the call
  failed, 0 when it succeeded);
- failed, denied, interrupted and backgrounded calls marked in red, amber or cyan;
- a folded tool group gets its total time and how many calls failed.

Durations are timed by the mod's own `tool.call` hook and kept per
`tool_use_id` (the same id the `ToolUse` row carries as `tool_use_id` and
`requestId`) in a `$.state` family, so a finishing call redraws its row
alone. Running rows, expanded groups, and any row whose props are not the
expected shape are left to the engine. On the desktop only failed or slow
calls get a badge, as one small SVG pill under the row.

`/toolmarks` toggles them (`/toolmarks on|off`), remembered across sessions.

## Türkçe

Transkriptteki araç satırlarına küçük rozetler: aile renkli glif ve süre,
Bash/PowerShell için çıkış kodu, başarısız/reddedilen/kesilen çağrılar için
renkli işaret, katlanmış gruplarda toplam süre ve hata sayısı. Motorun kendi
satırı korunur, rozet yanına eklenir; çalışan satırlar, açık gruplar ve
beklenmeyen biçimdeki satırlar motora bırakılır. Masaüstünde yalnızca hatalı
veya yavaş çağrılar bir SVG rozeti alır. `/toolmarks` aç/kapa yapar.

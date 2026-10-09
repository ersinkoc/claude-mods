# KOZMOS Compass

The single most useful hint, added to the dim line under the prompt. In
order of priority:

1. 5-hour limit at 90 % or more: `5h 91% — resets in 40m`
2. context at 80 % or more: `ctx 84% — /compact soon`
3. subagents still running: `◈ 3 agents working`
4. uncommitted changes after this session edited files: `✎ 6 files changed — commit?`
5. a draft left in the prompt for 3 minutes while idle: `⏎ draft waiting 4m — enter sends it`
6. otherwise nothing: the engine's own hint stands.

On the terminal it sets the line's `tail`, so the engine's line and its pills
stay live; other surfaces do not draw a tail yet, so there the hint leads the
line. A 2 s ticker reads `$.session.usage()` and `$.agent.list()`; once the
session has edited a file, a `git status` probe runs every 10 s. Values are
published to `$.state` only when they change.

`/compass` toggles it (`/compass on|off`), remembered across sessions.

## Türkçe

İstem satırının altındaki ipucu satırına o an en faydalı tek ipucunu ekler:
5 saatlik limit %90'ı geçtiyse sıfırlanma süresi, bağlam %80'i geçtiyse
`/compact` önerisi, çalışan alt ajan sayısı, dosya düzenlemelerinden sonra
commit edilmemiş değişiklikler, uzun süre bekleyen taslak; hiçbiri yoksa
motorun kendi ipucu. Terminalde satırın `tail` alanını kullanır, böylece
motorun satırı canlı kalır. `/compass` aç/kapa yapar.

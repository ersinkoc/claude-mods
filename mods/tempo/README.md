# Tempo

A Pomodoro focus timer above the prompt.

- `/tempo start [work=25] [break=5]` (also `start 50 10`), `/tempo stop`, `/tempo skip`, `/tempo` for the status,
  `/tempo hide` / `show` (or `✕`).
- Every fourth focus round earns a long break (three short ones). The timer is kept in the store, so it survives a
  restart and catches up on phases it slept through.
- At each phase end: a toast (and, with the `speak` setting, the system voice). Finished focus rounds are counted
  per day: `🍅×4 today`.
- During a break while Claude is still working, the band says *Break — Claude keeps going ☕*.

**Terminal:** an animated row: a tomato (or a steaming cup), the phase, a bar whose leading edge sizzles while a
glint sweeps the filled part, the time left with a blinking colon, and today's tally. **Desktop:** a progress ring
(stroke-dashoffset animation) around a bobbing tomato or a steaming cup, the clock, a progress track, the four-round
cycle and today's tomatoes. The band is hidden when no timer runs.

## Türkçe

İstemin üstünde bir Pomodoro odak zamanlayıcısı. `/tempo start [iş=25] [mola=5]`, `/tempo stop`, `/tempo skip`,
`/tempo` (durum). Her dördüncü turda uzun mola. Faz bitince bildirim (isteğe bağlı sesli), günlük `🍅×4 today`
sayacı. Moladayken Claude çalışmaya devam ediyorsa *Break — Claude keeps going ☕* yazar. Terminalde animasyonlu
çubuk ve süre, masaüstünde SVG halka. Zamanlayıcı yoksa band gizlidir.

# KOZMOS Marquee

A ticker in the status line under the prompt, refreshed every second:

```
◆ Opus 5.5·xhigh │ ctx 42% │ 5h 23% ↻2h41m │ 7d 41% │ $3.21 │ ⎇ main ↑2 ●3 │ ▶ Bash npm test 0:12
```

- **model:** model and effort. **ctx:** context fill. **limits:** each rate-limit window, the 5-hour one with its reset countdown. **cost:** session cost. **git:** branch, ahead/behind and the count of changed files (read every 10 s, and again after a Bash or edit). **tool:** the tool running in the main loop and for how long.
- When the line is longer than `width` it scrolls like a marquee: a window rotating over the segment loop, with `◆` between laps. Otherwise it stays still.
- `/marquee` turns it off (the status line is cleared) and on again; the choice is kept across sessions.

Settings: `width` (default `110`), `segments` (default `model,ctx,limits,cost,git,tool`: which segments, in which order).

## Türkçe

İstem satırının altındaki durum satırında her saniye yenilenen bir kayan yazı:

```
◆ Opus 5.5·xhigh │ ctx 42% │ 5h 23% ↻2h41m │ 7d 41% │ $3.21 │ ⎇ main ↑2 ●3 │ ▶ Bash npm test 0:12
```

- **model:** model ve efor. **ctx:** bağlam doluluğu. **limits:** her kullanım limiti penceresi; 5 saatlik olan sıfırlanma geri sayımıyla. **cost:** oturum maliyeti. **git:** dal, ileri/geri ve değişen dosya sayısı (10 saniyede bir, ayrıca bir Bash ya da düzenlemeden sonra okunur). **tool:** ana döngüde çalışan araç ve ne kadar süredir çalıştığı.
- Satır `width` değerinden uzunsa kayan yazı gibi kayar: segment döngüsü üzerinde dönen bir pencere, turlar arasında `◆`. Değilse sabit kalır.
- `/marquee` kapatır (durum satırı temizlenir) ve yeniden açar; tercih oturumlar arasında saklanır.

Ayarlar: `width` (varsayılan `110`), `segments` (varsayılan `model,ctx,limits,cost,git,tool`: hangi segmentler, hangi sırayla).

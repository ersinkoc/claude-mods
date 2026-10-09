# KOZMOS Launchpad

A pane of big launch buttons for the things you do every day.

- **Frequent:** Launchpad watches the slash commands you run from the prompt
  box and ranks them by how often (counts are kept between sessions). Commands
  that no longer exist drop out.
- **Pinned:** press `☆` on any command (or `/launchpad pin <cmd>`) to keep it
  at the top; `★` (or `/launchpad unpin <cmd>`) lets it go.
- **Saved:** `/launchpad save <text>` stores a prompt; pressing it fills the
  prompt box so you can edit before sending. `/launchpad rm <n>` removes one.

Pressing a command runs it at once. On the desktop each launcher is an SVG
tile (initial disc, name, description, use count and a small usage bar) with
its Run and pin buttons beside it; on the terminal each is a `[ ▶ /name ]`
button with a colored usage bar, count and when you last ran it.

`/launchpad` toggles the pane, `/launchpad list` prints everything,
`/launchpad forget` clears the counts. `autoOpen` (default off) opens the pane
at start.

## Türkçe

Her gün yaptığınız işler için büyük başlatma düğmeleri olan bir panel.

- **Sık kullanılanlar:** Launchpad istem kutusundan çalıştırdığınız eğik çizgi
  komutlarını izler ve ne sıklıkla kullandığınıza göre sıralar (sayılar
  oturumlar arasında saklanır). Artık var olmayan komutlar listeden düşer.
- **Sabitlenenler:** bir komutta `☆`'e basın (ya da `/launchpad pin <komut>`),
  en üstte kalsın; `★` (ya da `/launchpad unpin <komut>`) sabitlemeyi kaldırır.
- **Kayıtlı istemler:** `/launchpad save <metin>` bir istemi saklar; basınca
  istem kutusunu doldurur, göndermeden önce düzenleyebilirsiniz.
  `/launchpad rm <n>` birini siler.

Komut düğmesine basmak onu hemen çalıştırır. Masaüstünde her başlatıcı, yanında
Run ve sabitleme düğmeleri olan bir SVG kartıdır; terminalde renkli kullanım
çubuğu, sayı ve son kullanım zamanıyla bir `[ ▶ /ad ]` düğmesidir.

`/launchpad` paneli açıp kapatır, `/launchpad list` her şeyi yazar,
`/launchpad forget` sayıları sıfırlar. `autoOpen` (varsayılan kapalı) paneli
açılışta açar.

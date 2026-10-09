# KOZMOS Chronicle

The session as a timeline in a sidebar, newest first, each event stamped with
its local time (HH:MM:SS) and drawn with its own icon and color:

| Event | What is recorded |
| --- | --- |
| `❯` prompt | the first 80 characters of each prompt you submit |
| `◆` turn | its duration, the tools it called and the spend it added |
| `◈` / `◇` agent | a subagent spawned, and finished or failed with its run time |
| `◉` commit, `⇡` push | a successful `git commit` / `git push` through Bash, with sha, branch and message |
| `✖` failed tool | any tool call that errored or was denied |
| `⇊` compaction | manual or automatic, with tokens before → after |
| `▲` limit, `◔` context | crossing 50, 80 and 95 % of a rate-limit window or of the context |

Up to 300 events are kept. Filter buttons (hotkeys `1`–`5`) narrow the view
to All, Prompts, Agents, Git or Errors. A ribbon above squeezes the whole
session into one row, each slice colored by its loudest event.

On the desktop the header carries counters and the ribbon, and the timeline is
one SVG with a gradient rail, colored dots and a ripple on the newest event.

- `/chronicle` toggles the sidebar; `autoOpen` (default off) opens it at start.

## Türkçe

Oturumu kenar çubuğunda bir zaman çizelgesi olarak gösterir; en yeni en
üstte, her olay yerel saatiyle (SS:DD:ss) ve kendi simgesi ve rengiyle:

| Olay | Kaydedilen |
| --- | --- |
| `❯` istem | gönderdiğin her istemin ilk 80 karakteri |
| `◆` tur | süresi, çağırdığı araç sayısı ve eklediği maliyet |
| `◈` / `◇` ajan | başlatılan alt ajan; bitişi ya da hatası ve çalışma süresi |
| `◉` commit, `⇡` push | Bash ile başarılı `git commit` / `git push`; sha, dal ve mesaj |
| `✖` başarısız araç | hata veren ya da reddedilen her araç çağrısı |
| `⇊` sıkıştırma | elle ya da otomatik; önce → sonra token |
| `▲` limit, `◔` bağlam | bir kullanım penceresinin ya da bağlamın yüzde 50, 80 ve 95 eşiğini geçmek |

En fazla 300 olay tutulur. Süzgeç düğmeleri (kısayol `1`–`5`) görünümü
Tümü, İstemler, Ajanlar, Git ya da Hatalar ile daraltır. Üstteki şerit tüm
oturumu tek satıra sıkıştırır; her dilim en önemli olayının rengini alır.

Masaüstünde başlıkta sayaçlar ve şerit, zaman çizelgesi ise renk geçişli bir
ray, renkli noktalar ve en yeni olayda bir dalga ile tek bir SVG'dir.

- `/chronicle` kenar çubuğunu açar/kapatır; `autoOpen` (varsayılan kapalı)
  başlangıçta açar.

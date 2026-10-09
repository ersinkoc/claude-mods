# KOZMOS Polaroid

A snapshot of your session you can keep. `/polaroid` writes a self-contained
HTML report (no external assets, works offline) to
`<project>/.kozmos/reports/session-<date>-<time>.html`, answers with the path
and copies it to the clipboard. `/polaroid md` writes a Markdown version.

Polaroid collects everything live with its own hooks:

- title (your first prompt), model and other models seen, Claude Code version
- duration, cost (as `/cost` totals it), tokens by kind and request count
- context peak and a context-over-time chart, rate-limit readings with peaks
- tool calls by family (inline SVG bar chart) and the most-used tools
- a timeline of turns: prompt, duration, tools, tokens and cost of each
- subagents (type, model, time, tokens, cost, status)
- files read, edited and written; slash commands run

The page is a dark neon layout with a tilted polaroid of the session as a
night sky (one glowing star per turn, a horizon striped by tool family). It is
responsive down to phone width. Everything the session wrote into it is
escaped.

## Türkçe

Saklayabileceğiniz bir oturum fotoğrafı. `/polaroid`, dış kaynak kullanmayan,
çevrimdışı çalışan bir HTML raporunu
`<proje>/.kozmos/reports/session-<tarih>-<saat>.html` dosyasına yazar, yolu
yanıt olarak verir ve panoya kopyalar. `/polaroid md` Markdown sürümünü yazar.

Polaroid her şeyi kendi kancalarıyla canlı toplar: başlık (ilk isteminiz),
model ve görülen diğer modeller, Claude Code sürümü; süre, maliyet, türüne
göre token sayıları; bağlam zirvesi ve zaman içindeki grafiği, hız sınırı
okumaları; aile bazında araç çağrıları (satır içi SVG çubuk grafik); her turun
istem, süre, araç, token ve maliyetiyle zaman çizelgesi; alt ajanlar; okunan,
düzenlenen ve yazılan dosyalar; çalıştırılan komutlar.

Sayfa koyu neon bir düzendir; oturumu gece göğü olarak gösteren eğik bir
polaroid içerir. Telefon genişliğine kadar duyarlıdır. Oturumdan gelen her
metin kaçışlanır.

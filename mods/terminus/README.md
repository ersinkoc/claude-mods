# KOZMOS Terminus

The session's shell history in a sidebar. Every `Bash` and `PowerShell` tool
call — from the main loop and from every subagent — is recorded with its
command, the model's description, the working directory (an input `cwd` or a
leading `cd dir &&`), exit status or error line, duration, output size, who ran
it (`main` or the subagent's description) and the time.

- Header: total commands, failures, total shell time and a duration strip of the
  last runs (colored by status on the terminal, bars on the desktop).
- Filters: **All**, **Failed**, **Slow > 10 s**.
- Per row: **copy** puts the command on the clipboard, **↩ prompt** fills the
  prompt with `Run again: <command>`.
- Newest first, at most 300 runs kept.

`/terminus` toggles the pane, `/terminus list` prints the last runs. Set
`autoOpen` to open it on session start.

## Türkçe

Oturumun kabuk geçmişini kenar çubuğunda gösterir. Ana döngüden ve tüm alt
ajanlardan gelen her `Bash` ve `PowerShell` çağrısı; komut, modelin açıklaması,
çalışma dizini (girdideki `cwd` ya da baştaki `cd dizin &&`), çıkış durumu ya da
hata satırı, süre, çıktı boyutu, çalıştıran (`main` ya da alt ajanın açıklaması)
ve saatle kaydedilir.

- Başlık: toplam komut, başarısız sayısı, toplam kabuk süresi ve son çalıştırmaların
  süre şeridi.
- Filtreler: **All**, **Failed**, **Slow > 10 s**.
- Her satırda: **copy** komutu panoya kopyalar, **↩ prompt** istem kutusunu
  `Run again: <komut>` ile doldurur.
- En yeni en üstte, en fazla 300 kayıt tutulur.

`/terminus` paneli açar/kapatır, `/terminus list` son çalıştırmaları yazar.
Oturum başında açılması için `autoOpen` ayarını açın.

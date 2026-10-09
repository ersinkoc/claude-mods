# KOZMOS Gitscope

A git radar in a sidebar pane. `/gitscope` toggles it.

- **Header:** branch (or detached HEAD), upstream, ahead/behind or "in sync", and chips for staged, changed, new, conflicted files and stashes.
- **Commits:** the last 8 on a graph rail: sha, subject, age, author; newer dots glow violet, older ones fade.
- **Changes:** every file from `git diff --numstat HEAD` plus untracked files, with a green/red +/− histogram scaled to the busiest file.
- **Touched this session:** files the session edited (Edit, Write, NotebookEdit, in the main loop or any agent) get a ✎ marker and sort first.
- **Clean tree:** a small celebration. **Not a repo:** a friendly empty state.

Git runs only while the pane is open: every 5 s, and right after a Bash, PowerShell, Edit or Write call finishes. Terminal: colored rows with eighth-block bars. Desktop: SVG cards that follow the light and dark theme.

Settings: `autoOpen` (default `false`) opens the pane when a session starts.

## Türkçe

Kenar panelinde bir git radarı. `/gitscope` açıp kapatır.

- **Başlık:** dal (veya bağımsız HEAD), upstream, ileri/geri sayısı ya da "senkron", ve hazırlanmış, değişmiş, yeni, çakışmalı dosyalarla stash sayıları.
- **Commitler:** son 8 commit bir grafik rayı üzerinde: sha, başlık, yaş, yazar; yeni noktalar mor parlar, eskiler solar.
- **Değişiklikler:** `git diff --numstat HEAD` ile gelen her dosya ve izlenmeyen dosyalar, en yoğun dosyaya göre ölçeklenen yeşil/kırmızı +/− çubuklarıyla.
- **Bu oturumda dokunulanlar:** oturumun düzenlediği dosyalar (Edit, Write, NotebookEdit; ana döngü ya da herhangi bir ajan) ✎ işareti alır ve en üste sıralanır.
- **Temiz ağaç:** küçük bir kutlama. **Depo değilse:** dostça bir boş durum.

Git yalnızca panel açıkken çalışır: 5 saniyede bir ve bir Bash, PowerShell, Edit ya da Write çağrısı bittiğinde hemen. Terminal: renkli satırlar ve sekizlik blok çubuklar. Masaüstü: açık ve koyu temaya uyan SVG kartlar.

Ayar: `autoOpen` (varsayılan `false`) oturum başlarken paneli açar.

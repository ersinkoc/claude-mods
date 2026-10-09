# KOZMOS Thermal

A heatmap of the files this session touches, in a sidebar pane. `/thermal` toggles it.

Every `Read`, `Edit`, `Write`, `NotebookEdit` (by `file_path`) and every `Grep` / `Glob` with a `path` is counted, in the main loop and in agents. Each file keeps its reads, searches, edits, writes, last touch, and a **heat** score: read 1, search 0.5, edit 3, write 4, halving every 10 minutes. Paths are grouped as a directory tree under the session folder (files elsewhere sit under `↗ outside`); folders add up their children, and chains of single folders fold into one row (`src/lib`).

- **Terminal:** an indented tree, hottest first at every level, with five colored heat blocks `■■■□□`, the counts (`r` read, `s` search, `e` edit, `w` write) and the age of the last touch; as many rows as the pane holds.
- **Desktop:** a squarified treemap (folders nest with their name on a header strip), tiles sized by the metric and colored on a cold-indigo to hot-yellow ramp, labels where they fit, a tooltip per tile, the hottest file outlined.
- **Metric button** (`m`): cycles heat → reads → edits.

Settings: `autoOpen` (default `false`) opens the pane when a session starts.

## Türkçe

Oturumun dokunduğu dosyaların ısı haritası, bir kenar panelinde. `/thermal` açıp kapatır.

Her `Read`, `Edit`, `Write`, `NotebookEdit` (`file_path` ile) ve `path` verilmiş her `Grep` / `Glob` sayılır; ana döngüde de ajanlarda da. Her dosya okuma, arama, düzenleme, yazma sayılarını, son dokunuşu ve bir **ısı** puanını tutar: okuma 1, arama 0.5, düzenleme 3, yazma 4; ısı her 10 dakikada yarıya iner. Yollar oturum klasörü altında bir dizin ağacı olarak gruplanır (dışarıdaki dosyalar `↗ outside` altında); klasörler çocuklarını toplar, tek klasörlük zincirler tek satıra katlanır (`src/lib`).

- **Terminal:** her seviyede en sıcak önde, girintili bir ağaç; beş renkli ısı bloğu `■■■□□`, sayılar (`r` okuma, `s` arama, `e` düzenleme, `w` yazma) ve son dokunuşun yaşı; panelin sığdırdığı kadar satır.
- **Masaüstü:** kare oranlı bir ağaç haritası (treemap; klasörler başlık şeridinde adlarıyla iç içe), karolar metriğe göre boyutlanır ve soğuk çividen sıcak sarıya giden bir renk skalasıyla boyanır, sığdığı yerde etiket, her karoda ipucu, en sıcak dosyanın çevresi vurgulu.
- **Metrik düğmesi** (`m`): ısı → okuma → düzenleme arasında döner.

Ayar: `autoOpen` (varsayılan `false`) oturum başlarken paneli açar.

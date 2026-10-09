# KOZMOS Taskforge

A live kanban of the session's tasks in a sidebar. Every `TodoWrite` list and
every `TaskCreate` / `TaskUpdate` task lands in one of three columns:
**Pending**, **In progress** and **Done**.

Cards show the subject, the active form while in progress (`Fixing the
tokenizer`), how long the card has sat in its column, the task id and the
owner: the `owner` a TaskUpdate set, or the subagent whose call wrote it.
A subagent's todo list stays its own; a new list from the same loop replaces
the old one, and a deleted task leaves the board.

The header has the percentage done, one bar split into done / in progress /
pending, the counts and the time since the first task.

- Terminal: three side-by-side columns from 72 columns wide, stacked sections
  (in progress first) below that.
- Desktop: an SVG header and an SVG board; in-progress cards wear a marching
  dashed border and a pulsing dot.
- `/taskforge` toggles the sidebar; `autoOpen` (default off) opens it at start.

## Türkçe

Oturumun görevlerini kenar çubuğunda canlı bir kanban olarak gösterir. Her
`TodoWrite` listesi ve her `TaskCreate` / `TaskUpdate` görevi üç sütundan
birine düşer: **Pending**, **In progress** ve **Done**.

Kartlarda konu, sürerken etkin hali (`Fixing the tokenizer`), kartın bu
sütunda ne kadar beklediği, görev numarası ve sahibi görünür: TaskUpdate'in
verdiği `owner` ya da çağrıyı yapan alt ajan. Bir alt ajanın yapılacaklar
listesi kendine aittir; aynı döngüden gelen yeni liste eskisinin yerini alır,
silinen görev panodan çıkar.

Başlıkta tamamlanma yüzdesi, bitti / sürüyor / bekliyor diye bölünmüş tek
bir çubuk, sayılar ve ilk görevden bu yana geçen süre var.

- Terminal: 72 sütundan genişte yan yana üç sütun, daha darda alt alta
  bölümler (önce sürenler).
- Masaüstü: SVG başlık ve SVG pano; süren kartların kenarı yürüyen kesikli
  çizgiyle ve nabız gibi atan bir noktayla çizilir.
- `/taskforge` kenar çubuğunu açar/kapatır; `autoOpen` (varsayılan kapalı)
  başlangıçta açar.

# Epilogue

A recap after every main turn, shown as a compact band until you send the next prompt:

- how long the turn took, its estimated cost (summed from every model request of the turn, subagents included, at
  list prices), the session cost delta from the engine's own ledger, and the tokens moved;
- the tools used, as colored chips per family (Edit, Shell, Read, Agent, Web, Tasks, MCP);
- the files written (Edit / Write / NotebookEdit), the subagents spawned and the tools that failed;
- optionally an AI one-liner: with the `aiSummary` setting on, `claude-haiku-5-5` sums up the answer in at most 15 words.

`/epilogue` opens a pane with the last 20 recaps; `/epilogue hide` / `show` (or `✕`) controls the band.
Terminal: colored text with filled chips. Desktop: one SVG card per recap, sliding in with a shine.

## Türkçe

Her ana turdan sonra, bir sonraki isteme kadar görünen kısa bir özet bandı: süre, tahmini maliyet ve oturum
maliyet farkı, token sayısı, araç ailelerine göre renkli etiketler, yazılan dosyalar, başlatılan alt ajanlar ve
başarısız araçlar. `aiSummary` açıksa `claude-haiku-5-5` cevabı en fazla 15 kelimeyle özetler. `/epilogue` son 20
özeti bir panelde açar.

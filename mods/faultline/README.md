# KOZMOS Faultline

The error lens: a sidebar of everything that went wrong this session.

- Every failed tool call (`isError`) and every denied or refused one (a hook's
  `deny`, a permission refusal), from the main loop and from subagents.
- Turns that ended on a refusal (with the API's category and explanation) or
  on an API error, and API errors seen through the `StopFailure` hook
  (`rate_limit`, `overloaded`, … with their details).
- Failures are grouped by a **signature**: the tool plus the first telling
  error line with numbers, paths, URLs and ids masked, so "File does not exist:
  /a.ts" and "… /lib/b.ts" are one group.
- Each group shows its count, first and last time, the agents that hit it,
  what the first call was about, the first lines of the first error (▾ more
  unfolds the full text) and a **copy** button.
- A header severity strip: 20 cells over the last 10 minutes, redder with more
  failures.

`/faultline` toggles the pane, `/faultline list` prints the top signatures. Set
`autoOpen` to open it on session start.

## Türkçe

Hata merceği: oturumda ters giden her şeyi gösteren kenar çubuğu.

- Ana döngüden ve alt ajanlardan gelen her başarısız araç çağrısı (`isError`)
  ve reddedilen her çağrı (bir hook'un `deny`'ı, izin reddi).
- Ret (API'nin kategorisi ve açıklamasıyla) ya da API hatasıyla biten turlar ve
  `StopFailure` hook'u ile görülen API hataları (`rate_limit`, `overloaded`, …).
- Hatalar bir **imza** ile gruplanır: araç ve sayıları, yolları, URL'leri ve
  kimlikleri maskelenmiş ilk anlamlı hata satırı.
- Her grup; sayısını, ilk ve son görülme zamanını, ona takılan ajanları, ilk
  çağrının neyle ilgili olduğunu, ilk hatanın ilk satırlarını (▾ more tamamını
  açar) ve bir **copy** düğmesini gösterir.
- Başlıkta son 10 dakikanın şiddet şeridi: 20 hücre, hata arttıkça kızarır.

`/faultline` paneli açar/kapatır, `/faultline list` en sık imzaları yazar.
Oturum başında açılması için `autoOpen` ayarını açın.

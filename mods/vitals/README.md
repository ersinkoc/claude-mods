# KOZMOS Vitals

A btop-style machine monitor in a sidebar pane. `/vitals` toggles it.

- **CPU:** load now, 30-sample average and peak, and a history graph of the last 120 samples (four minutes).
- **RAM:** used / total, a bar and its own history.
- **Disk:** `C:` on Windows, `/` elsewhere.
- **GPU:** utilization, VRAM and temperature from `nvidia-smi`, when it answers; the section is left out otherwise.
- **Processes:** the count.
- **Claude footer:** session time, tool calls so far, agents running.

It samples every 2 s **only while the pane is open** (one PowerShell call on Windows, `/proc` + `df` + `ps` on Linux, `top` on macOS). Terminal: braille graphs as colored Rasters, each row tinted by the height it stands for (green low, red high), plus eighth-block bars. Desktop: one SVG card per section with gradient area charts, a dashed grid and a pulsing live dot, in light and dark.

Settings: `autoOpen` (default `false`) opens the pane when a session starts.

## Türkçe

Kenar panelinde btop tarzı bir makine izleyicisi. `/vitals` açıp kapatır.

- **CPU:** anlık yük, son 30 örneğin ortalaması ve tepe değeri, son 120 örneğin (dört dakika) geçmiş grafiği.
- **RAM:** kullanılan / toplam, bir çubuk ve kendi geçmişi.
- **Disk:** Windows'ta `C:`, diğerlerinde `/`.
- **GPU:** `nvidia-smi` yanıt verirse kullanım, VRAM ve sıcaklık; yoksa bölüm gösterilmez.
- **Süreçler:** sayı.
- **Claude alt bilgisi:** oturum süresi, araç çağrısı sayısı, çalışan ajanlar.

**Yalnızca panel açıkken** 2 saniyede bir örnekler (Windows'ta tek bir PowerShell çağrısı, Linux'ta `/proc` + `df` + `ps`, macOS'ta `top`). Terminal: renkli Raster olarak braille grafikler, her satır temsil ettiği yüksekliğe göre renklenir (altta yeşil, üstte kırmızı), ve sekizlik blok çubuklar. Masaüstü: her bölüm için gradyanlı alan grafikleri, kesikli ızgara ve nabız gibi atan canlı nokta içeren bir SVG kart; açık ve koyu temada.

Ayar: `autoOpen` (varsayılan `false`) oturum başlarken paneli açar.

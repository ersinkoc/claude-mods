# KOZMOS Skies

The session's weather above the prompt, from the climate of the work:

| Weather | When |
| --- | --- |
| ⛈ Storm | 5+ of the last 20 tool calls failed, or the 5-hour window is 95 %+ used |
| 🌫 Fog | context over 85 % |
| 🌧 Rain | 3–4 failures, 5-hour use 85 %+, or 10+ minutes without a working tool while busy |
| ⛅ Cloudy | any failure, context 65 %+, 5-hour use 70 %+, or 4+ minutes without a working tool |
| 🌤 Fair | context 40 %+ or 5-hour use 50 %+ |
| ☀ Clear | otherwise |
| 🌙 Night | 22:00–06:00 local time while idle, over calm or cloudy skies |
| 🌈 Rainbow | 30 s after a storm clears (also when it eases through rain first) |

The forecast line reads like `⛈ Storm · 6/20 tools failed · ctx 91 % · 5h 88 %`. The local hour comes from the machine's time zone, asked once per session (PowerShell on Windows, `date +%z` elsewhere), since the hooks' own clock may not know it.

Terminal: a `Client` scene of three rows of half-block pixels with glyphs on top (a turning sun, drifting clouds, falling rain, lightning, fog banks, twinkling stars and a crescent moon, a shimmering rainbow) and the forecast line; a short band gets the forecast line alone. Desktop: one animated SVG sky with the forecast on a frosted pill, in light and dark.

Shown once the session has worked (a turn or a tool call). `/skies` shows or hides it; `✕` hides it. The choice is kept across sessions.

## Türkçe

İstemin üstünde oturumun hava durumu, işin ikliminden:

| Hava | Ne zaman |
| --- | --- |
| ⛈ Fırtına | son 20 araç çağrısının 5+'ı başarısız ya da 5 saatlik pencere %95+ dolu |
| 🌫 Sis | bağlam %85 üstü |
| 🌧 Yağmur | 3–4 hata, 5 saatlik kullanım %85+, ya da meşgulken 10+ dakikadır çalışan bir araç yok |
| ⛅ Bulutlu | herhangi bir hata, bağlam %65+, 5 saatlik kullanım %70+, ya da 4+ dakikadır çalışan araç yok |
| 🌤 Az bulutlu | bağlam %40+ ya da 5 saatlik kullanım %50+ |
| ☀ Açık | diğer durumlar |
| 🌙 Gece | yerel saatle 22:00–06:00 arası, boştayken, sakin ya da bulutlu gökte |
| 🌈 Gökkuşağı | fırtına dindikten sonra 30 sn (önce yağmura dönse bile) |

Tahmin satırı şöyle okunur: `⛈ Storm · 6/20 tools failed · ctx 91 % · 5h 88 %`. Kancaların kendi saati saat dilimini bilmeyebileceği için yerel saat, oturum başına bir kez makinenin saat diliminden sorulur (Windows'ta PowerShell, diğerlerinde `date +%z`).

Terminal: üç satır yarım blok pikselin üstüne karakterlerle çizilmiş bir `Client` sahnesi (dönen güneş, sürüklenen bulutlar, yağan yağmur, şimşek, sis kümeleri, parıldayan yıldızlar ve hilal, ışıldayan gökkuşağı) ve tahmin satırı; kısa bantta yalnızca tahmin satırı. Masaüstü: tahmini buzlu bir hap üzerinde gösteren, açık ve koyu temada çalışan tek animasyonlu SVG gökyüzü.

Oturum çalışmaya başlayınca (bir tur ya da araç çağrısı) görünür. `/skies` gösterir veya gizler; `✕` gizler. Seçim oturumlar arasında saklanır.

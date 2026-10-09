# KOZMOS Glyphfall

Matrix rain of tool activity, above the prompt while Claude works.

- Every **tool call** drops its name and a piece of its detail (`Grep turn.step`, `Bash npm test`) as a **wave of letters across neighbouring columns**, colored by tool family: each letter a bright head with a fading tail of glyphs above it. The word hangs mid-band, readable, **for as long as the tool runs**, then falls out. Words in flight together never overlap.
- Quiet columns rain half-width katakana and symbols at low density, tinted by the latest tool.
- The last line lists the **last five tools** as colored chips (a spinner while running, `✖` when failed).

**Terminal:** a Client module, 3–4 rows full width at 30 fps. **Desktop:** one SVG: rain columns falling by CSS `translateY`, tool letters dropping in and out with a glow, chips on a theme-aware strip.

Idle (no turn running) it draws nothing. `✕` hides it; `/glyphfall` toggles it.

## Türkçe

Claude çalışırken istem satırının üstünde araç etkinliğinden bir Matrix yağmuru.

- Her **araç çağrısı**, adını ve ayrıntısından bir parçayı (`Grep turn.step`, `Bash npm test`) **komşu sütunlara yayılan bir harf dalgası** olarak düşürür; renk araç ailesinden gelir, her harfin parlak bir başı ve üstünde solan bir kuyruğu vardır. Kelime, **araç çalıştığı sürece** bandın ortasında okunur biçimde asılı kalır, sonra düşer. Aynı anda düşen kelimeler üst üste binmez.
- Sessiz sütunlara seyrek yarım genişlikte katakana ve simgeler yağar.
- Son satır **son beş aracı** renkli etiketler olarak gösterir.

**Terminal:** 3–4 satır, tam genişlik, 30 fps Client modülü. **Masaüstü:** CSS ile düşen sütunlar ve parlayan harflerle tek bir SVG.

Boştayken hiçbir şey çizmez. `✕` gizler; `/glyphfall` açar/kapatır.

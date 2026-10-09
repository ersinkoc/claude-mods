# KOZMOS Verdict

Test, build and lint results, above the prompt. Verdict watches the `Bash`
and `PowerShell` commands Claude runs, recognizes test runners, type checkers,
linters and builds, parses their output and keeps a short history per runner
for each project.

`✓ tsc 0 errors ▇▇█ · ✗ vitest 3 failed ▆▇▇█▅ · ✓ eslint 0 errors`

- **Recognized**: vitest, jest, mocha, bun test, pytest, go test, cargo
  test / build / check / clippy, dotnet test / build, maven, gradle, `npm|pnpm|yarn|bun
  test`, tsc / vue-tsc / `typecheck` scripts, eslint / `lint` scripts,
  `npm run build`, vite / next / webpack / tsup / esbuild builds, go build / vet.
  Words inside paths (`cat vitest.config.ts`) do not count.
- **Parsed**: passed / failed / skipped, error and warning counts, the names
  of failing tests (vitest `FAIL … > …`, jest `●`, pytest `FAILED`, go
  `--- FAIL`, cargo `... FAILED`, dotnet `Failed …`, mocha `1) …`, bun
  `(fail)`, gradle `> … FAILED`) and the first error lines (tsc `file:line
  TSxxxx`, eslint `file:line message (rule)`, rustc with its `-->` location,
  maven `[ERROR]`). An unknown failing build still shows its first error-like lines.
- **Terminal band**: a Client surface module; chips per runner with a
  sparkline of the last 10 runs (green passes, red failures); a failing chip's
  beacon and text pulse red, and a second row types out the failing tests one
  after another.
- **Desktop band**: one SVG of pills with sparkline bars; failing pills pulse
  with a red glow, and a second line cycles through the failures by CSS.
- **`/verdict`** opens a pane: each runner's last result and sparkline, then
  the 25 most recent runs with their command, time, duration and the failing
  test names / first error lines. `/verdict hide|show` toggles the band
  (also `✕`), `/verdict clear` forgets this project's history.
- The band shows once a run happened in this session; history persists per
  project in the plugin store (60 runs).

## Türkçe

Test, derleme ve lint sonuçları istemin üstünde. Verdict, Claude'un çalıştırdığı
`Bash` ve `PowerShell` komutlarını izler; test koşucularını, tip denetleyicileri,
linter'ları ve derlemeleri tanır, çıktılarını ayrıştırır ve her proje için
koşucu başına kısa bir geçmiş tutar.

- **Tanınanlar**: vitest, jest, mocha, bun, pytest, go test, cargo, dotnet,
  maven, gradle, `npm test`, tsc, eslint, `npm run build`, vite/next/webpack…
- **Ayrıştırılanlar**: geçen / kalan / atlanan sayıları, hata ve uyarı sayıları,
  başarısız testlerin adları ve ilk hata satırları.
- **Terminal**: koşucu başına çipler ve son 10 koşunun kıvılcım grafiği;
  başarısız çip kırmızı nabız atar, ikinci satır başarısız testleri tek tek yazar.
- **Masaüstü**: tek SVG; başarısız haplar kırmızı parlar, hatalar CSS ile döner.
- **`/verdict`** son koşuları ve başarısız test adlarını listeleyen bir panel
  açar. `/verdict hide|show` bandı gizler/gösterir (`✕` de gizler),
  `/verdict clear` bu projenin geçmişini siler.

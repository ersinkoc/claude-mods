# KOZMOS Helm

One-press settings profiles in a sidebar. Each profile sets Claude Code up for
one way of working; press it to see exactly what it changes, leave out any step
you don't want, then **Apply**. Every activation can be undone.

| Profile | For | Sets |
| --- | --- | --- |
| ◔ **Token saver** | spending less | Sonnet, effort `low`, Haiku subagents, Concise output, no prompt suggestions or recap, auto-compact, small workflows, no `ultracode` keyword, no carrying on at the usage limit, MCP output capped at 10,000 tokens |
| » **Fast flow** | less waiting | Sonnet, effort `medium`, edits auto-accepted, Concise output, prompt suggestions, turn duration and progress bar, medium workflows |
| ◆ **Max quality** | the best result | `best` model, effort `xhigh`, subagents keep their own model, default output, large workflows with the `ultracode` keyword, checkpoints, auto-compact |
| ◇ **Plan first** | think, then build | `opusplan` (Opus plans, Sonnet builds), effort `high`, plan mode by default and never on its own, questions wait for you, checkpoints |
| ▣ **Guarded** | control and safety | every edit and command asks, `bypassPermissions` disabled, `Read` deny rules for `.env`, `secrets/`, `~/.ssh`, `~/.aws` (they stop the Read tool, not a Bash `cat`), questions never answer themselves, checkpoints, verbose |
| ➤ **Autopilot** | long unattended runs | auto mode (also while planning), effort `high`, workflows, a question waits 5 minutes then work goes on, carrying on at the usage limit, recap, push notifications, auto-compact |
| ☾ **Quiet focus** | fewer distractions | no tips, prompt suggestions, pushes, recap or PR footer; reduced motion |
| ★ **Your own** | coming back to your setup | `/helm save <name>` (or **⎘ Save my setup**) records every setting the built-ins touch, as it is now |

Each card shows how much of the profile is already in force (`4/8`, or
`✓ in force`). In the detail, `●` is a change (old value struck through, the new
one and why), `✓` is already set and `⊘` is skipped (locked by your
organization, missing from this Claude Code version, or a value it does not
offer). Press `☑` beside a change to leave it out of this activation. When the
5-hour or weekly limit passes `suggestAt` (80 %), Token saver is marked
**suggested**.

## Commands

| Command | What it does |
| --- | --- |
| `/helm` | toggles the pane |
| `/helm <profile>` | opens the pane on that profile (prints its plan where no pane fits) |
| `/helm apply <profile>` | applies it and lists what changed and what was skipped |
| `/helm save <name>` · `/helm rm <name>` | saves your current setup as a profile (up to 6) · removes one |
| `/helm undo` | reverts the last activation (also **↶ Undo** in the pane) |
| `/helm list` · `/helm history` | every profile with its progress · the last 20 activations |

Profile ids: `saver`, `flow`, `quality`, `planner`, `guarded`, `autopilot`,
`quiet`, and `my-<name>` for yours; a profile's name works too.

## Where each change lands

- **`/config` rows** (model, permission mode, output style, auto-compact…) go
  through `$.config.set`, exactly as if you changed them in `/config`.
- **Effort** is saved per model, the way `/effort` saves it:
  `modelSettings["<model id>"].effortLevel` in `~/.claude/settings.json`. When
  the profile keeps your model, Helm saves it at once for the model in use;
  when it switches model, it saves it under the id your next request names, and
  sends that request at the new effort. A model id with a dot (Bedrock, Vertex)
  cannot be saved this way; the effort then rides along with requests only.
- **Keys with no `/config` row** (`env.CLAUDE_CODE_SUBAGENT_MODEL`,
  `env.MAX_MCP_OUTPUT_TOKENS`, `permissions.deny`,
  `permissions.disableBypassPermissionsMode`) are written to
  `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). The first
  write of each session copies the file to `settings.json.helm.bak`. A file
  that is not valid JSON is never overwritten: those steps are skipped and the
  pane says why.

settings.json is written before any `/config` row, and Helm waits until Claude
Code has reloaded it: the engine writes rows from the settings it holds, so a
row set first would quietly put the old file back. If the engine never
reloads, the row changes are skipped and you are asked to restart the session.

Undo puts back exactly the values an activation changed, newest first; a deny
rule you added yourself since stays. A settings.json that cannot be restored
keeps the history entry, so `/helm undo` can be run again once it is fixed.
The env variables are read when Claude Code starts, so count on them from the
next session.

## Türkçe

Kenar çubuğunda tek dokunuşla ayar profilleri. Her profil Claude Code'u bir
çalışma biçimine göre ayarlar; profile basınca tam olarak neyi değiştireceğini
görürsünüz, istemediğiniz adımı dışarıda bırakır, sonra **Apply**'a basarsınız.
Her etkinleştirme geri alınabilir.

- **◔ Token saver:** daha az harcama — Sonnet, düşük efor, Haiku alt ajanlar,
  kısa yanıtlar, kullanım limitinde otomatik devam yok, MCP çıktısı 10.000
  tokenla sınırlı.
- **» Fast flow:** daha az bekleme — Sonnet, orta efor, düzenlemeler otomatik
  kabul.
- **◆ Max quality:** en iyi sonuç — `best` model, `xhigh` efor, büyük iş akışları.
- **◇ Plan first:** önce plan — `opusplan` (Opus planlar, Sonnet yazar), plan
  modu varsayılan, onayınız olmadan çalışmaz.
- **▣ Guarded:** kontrol ve güvenlik — her işlem sorar, bypass kapalı,
  `.env`/`secrets/`/`~/.ssh`/`~/.aws` okuma yasağı.
- **➤ Autopilot:** uzun gözetimsiz işler — auto mod, soru 5 dakika bekler,
  özet ve anlık bildirimler.
- **☾ Quiet focus:** dikkat dağıtmayan — ipucu, öneri, bildirim ve animasyon yok.
- **★ Kendi profiliniz:** `/helm save <ad>` (ya da **⎘ Save my setup**)
  şu anki ayarlarınızı kaydeder; tek dokunuşla geri dönersiniz.

Her kart profilin ne kadarının zaten geçerli olduğunu gösterir (`4/8` ya da
`✓ in force`). Detayda bir değişikliğin yanındaki `☑`'e basarak onu bu
etkinleştirmenin dışında bırakabilirsiniz. 5 saatlik ya da haftalık limit
`suggestAt` (%80) eşiğini geçince Token saver **suggested** olarak işaretlenir.

`/helm` paneli açıp kapatır; `/helm <profil>` o profili açar,
`/helm apply <profil>` uygular, `/helm save <ad>` / `/helm rm <ad>` kendi
profillerinizi yönetir, `/helm undo` (ya da paneldeki **↶ Undo**) son
etkinleştirmeyi geri alır, `/helm list` ve `/helm history` durumu yazar.

`/config` satırları menünün yazdığı gibi `$.config.set` ile yazılır. Efor,
`/effort`'un yaptığı gibi model başına `modelSettings["<model id>"].effortLevel`
olarak kaydedilir (model değişmiyorsa hemen). `/config`'te satırı olmayan
anahtarlar `~/.claude/settings.json`'a yazılır; her oturumun ilk yazımında dosya
`settings.json.helm.bak` olarak yedeklenir, geçerli JSON olmayan dosyaya asla
yazılmaz. settings.json önce yazılır ve Claude Code dosyayı yeniden yükleyene
kadar beklenir; ancak sonra `/config` satırları değiştirilir.

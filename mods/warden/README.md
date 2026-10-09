# KOZMOS Warden

A guard for destructive shell commands. Before Claude or a subagent runs a
`Bash` or `PowerShell` command that matches a risk rule, warden stops and asks
you: **Allow once** or **Deny**. When nobody can answer (a dismissed dialog, a
`-p` run) the command is refused, and if warden itself fails it fails closed.

| Severity | Rules |
| --- | --- |
| critical | `rm -r` / `Remove-Item -Recurse` / `rd /s` on `/`, `~`, `C:\`, a home or system folder (and `$VAR/` that would become `/`), `mkfs`, `dd of=/dev/…`, `format C:`, `Format-Volume`, `DROP DATABASE` |
| high | `rm -rf .` / `*` / `..`, `git push --force` (not `--force-with-lease`), `git reset --hard`, `git clean -f[d]`, `git checkout -- .`, `git restore .`, `DROP TABLE`, `TRUNCATE`, `del /s`, `shutdown`, `chmod -R 777`, `curl … \| sh`, `iex (irm …)`, your own patterns |
| medium | `git branch -D`, `git stash clear` / `drop` |

Look-alikes are left alone on purpose: `rm -rf node_modules`, `rm -rf dist`,
any named path inside the project, `/tmp/…`, `git push --force-with-lease`,
`git clean -n`, `git checkout -- one-file`, and SQL words inside `grep`,
`echo` or a commit message. Commands inside `bash -c`, `powershell -Command`,
`cmd /c` and `$( … )` are judged too.

- **Terminal:** a one-row band `🛡 warden blocked: git push --force · high · …` for 8 s, with a countdown and ✕.
- **Desktop:** the same band as one SVG: a shield, the rule, a severity chip and a burning fuse.
- `/warden` prints the rules and this session's blocked / allowed / warned log; `/warden hide` and `/warden show` toggle the band (kept across sessions).

Settings: `mode` (`ask` default, `deny`, `warn`) and `extraPatterns`
(regexes separated by `;;`, e.g. `kubectl delete ;; terraform destroy`).

## Türkçe

Yıkıcı kabuk komutlarına karşı bir bekçi. Claude ya da bir alt ajan bir risk
kuralına uyan `Bash` veya `PowerShell` komutu çalıştırmadan önce warden durur
ve sorar: **Allow once** (bir kez izin ver) ya da **Deny** (reddet). Kimse
yanıt veremezse (iletişim kutusu kapatıldıysa, `-p` çalışmasıysa) komut
reddedilir; warden'ın kendisi hata verirse yine reddeder (kapalı başarısızlık).

Seviyeler: **critical** — kök, sürücü, ev ya da sistem klasörünü silmek,
`mkfs`, `format C:`, `DROP DATABASE`; **high** — `git push --force`,
`reset --hard`, `clean -fd`, `checkout -- .`, `DROP TABLE`, `TRUNCATE`,
`del /s`, `shutdown`, `chmod -R 777`, `curl | sh`, kendi kalıplarınız;
**medium** — `git branch -D`, `git stash clear`.

Benzer görünen zararsız komutlara dokunulmaz: `rm -rf node_modules`,
`rm -rf dist`, projenin içindeki adlı yollar, `--force-with-lease`,
`git clean -n`, `grep` / `echo` / commit mesajı içindeki SQL sözcükleri.

- **Terminal:** engellemeden sonra 8 saniye görünen tek satırlık bant ve ✕.
- **Masaüstü:** kalkan, kural, önem çipi ve yanan fitilli tek bir SVG.
- `/warden` kuralları ve bu oturumun kaydını gösterir; `/warden hide|show` bandı gizler/gösterir.

Ayarlar: `mode` (`ask`, `deny`, `warn`) ve `extraPatterns` (`;;` ile ayrılmış düzenli ifadeler).

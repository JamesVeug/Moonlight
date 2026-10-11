# AGENTS.md

## Working with the user

- The user is a Senior Unity Developer. Do not take shortcuts or add hacky solutions unless explicitly requested.
- Get approval before refactoring.
- Give direct answers and keep progress updates brief.

Guidance for AI agents working in this repository. Moonlight is a **MapleStory GMS v214 private server** based on the Swordie source, plus an authentication hook and a launcher. See `README.md` (upstream overview) and `LOCAL-SETUP.md` (this machine's setup, rates, validation logs).

## Repository layout

| Path | What it is |
|------|------------|
| `Server/` | Java (Maven) game server. Source under `Server/src/main/java/net/swordie/ms/`. Runs in Docker/Podman. |
| `Server/scripts/` | Python NPC/quest/field scripts (Jython), mounted read-only into the container. |
| `Server/wz/` | Exported v214 WZ game data (XML). Required for the server to boot. |
| `Server/sql/` | DB schema + seed, auto-imported on first MySQL volume init only. |
| `auth_hook/Client210/` | C++ client auth hook. Builds as `ijl15.dll`, deployed as `Moonlight.dll`. |
| `Launcher/v214/` | C# (.NET Framework 4.8) WinForms launcher. Builds `Moonlight v214 Launcher.exe`. |
| `client/`, `client-overlay/` | The v214 game client + deployed `Moonlight.dll` and launcher. `client/` is ~17 GB. |
| `tools/WzExport/` | WZ → XML exporter (HaRepacker MapleLib). |

## Running the server (Windows + Podman)

This machine runs the server in a Podman VM (`podman-machine-default`, WSL) via Docker-compatible compose. Two helper scripts wrap it:

```powershell
./Start-Moonlight.ps1            # start (builds image if missing)
./Start-Moonlight.ps1 -Rebuild   # rebuild server image after Java/source changes, then start
./Compose.ps1 logs -f server     # follow server logs
./Compose.ps1 stop               # stop (preserves DB + DAT volumes; allow ~2 min for graceful shutdown)
./Compose.ps1 ps                 # container status
```

**Gotchas for agents:**
- **PowerShell execution policy can vary between shells.** The call operator and an absolute path do not bypass execution policy. If a helper is blocked, invoke it with `powershell -ExecutionPolicy Bypass -File ...` for that process rather than changing the user's persistent policy.
- **Port 8484 conflicts:** another MapleServer (`heavenms-server`) sometimes squats on 8484. Check `podman --connection podman-machine-default ps -a` and stop the conflicting container.
- **Never `docker-compose down -v`** or run `Server/init_database.sh` unless intentionally wiping all accounts/characters. MySQL only imports `Server/sql/` into a fresh data volume.
- `Compose.ps1` sets `DOCKER_HOST=npipe:////./pipe/docker_engine` so compose talks to Podman's API.

Ports: login `8484`, API `8483`, channels `8585-8594` (10x Bera). DB (MySQL 8.0) is internal to the container network.

## Rates and deployment verification

- Current monster rates in `GameConstants.java`: EXP **50x**, mesos **100x**, item drops **25x**. Keep `LOCAL-SETUP.md` in sync when changing these constants.
- Build the replacement image before stopping the running server. For an explicit graceful stop, use `podman --connection podman-machine-default stop --time 120 moonlight-server`. Confirm `Accounts have been saved.` and `Shutdown complete!` in the logs before starting the replacement with `./Compose.ps1 up -d --no-build server`.
- After a Java change, verify the deployed build, not just the source. Run `./tools/Verify-Server.ps1` to check all 16 client archive API checks and v214 handshakes on login and all ten channel ports.

## Existing compatibility fixes

- `SkillInfo.java` creates Nashorn through `NashornScriptEngineFactory`; JavaScript engine lookup by name failed in the shaded Java 17 server and blocked skill processing.
- The launcher resolves files relative to its executable and validates the explicit required WZ filenames. The game generates an extra `Data.wz`; do not restore an exact directory file-count check. Checksum requests share a socket and must remain sequential.
- `Server/scripts/npc/1061002.py` opens Mr. Sweatbottom's existing shop (19 database items). NPC scripts are read and compiled on each invocation, so close an existing dialogue and reopen it to load changes.
- `Starting script q29901s` is a normal debug message for the Junior Adventurer quest, not a missing-script error.

## Database access

Credentials live in `.env` (DB name `Moonlight`, user `moonlight`/`password`). Run SQL inside the container:

```powershell
./Compose.ps1 exec mysql mysql -umoonlight -ppassword Moonlight -e "SELECT ..."
```

Account rank is `users.accounttype` (stored as the `AccountType` enum **ordinal**, `@Enumerated(ORDINAL)`): `0`=Player, `1`=Tester, `2`=Intern, `3`=GameMaster, `4`=Admin. Changes require the player to relog (account type is cached in memory at login).

**Passwords & creating accounts directly:** `password` is stored hashed, but `LoginHandler`/`ApiRequestHandler` check `Util.isStringBCrypt(dbPassword)` first — if the stored value is NOT a BCrypt hash it's compared as **plaintext** and auto-upgraded to a hash on the next successful login. So you can set a password with `UPDATE users SET password='password' WHERE name='x';` and it just works. All `users` columns are nullable except `id`, so you can pre-create a full account (skipping the in-game Create Account flow) with e.g. `INSERT INTO users (name, password, accounttype, characterslots, pblockreason) VALUES ('theveug','password',4,4,3);` — the `accounts`/character rows are created on first login. Account creation requires name ≥ 4 chars and password ≥ 4 chars.

## In-game commands

Two prefixes: `@` = player commands (`PlayerCommands.java`), `!` = admin commands (`AdminCommands.java`). Permission check is `accountType.ordinal() >= requiredType.ordinal()`. Most useful admin commands require **Tester+**: `!nx <n>` (NX Prepaid / Cash Shop), `!maplepoints <n>`, `!vp <n>` (vote points, used by custom NPC shops — NOT the Cash Shop), `!item <id|name> [qty]`. The Cash Shop spends NX Credit / NX Prepaid / Maple Points (`CashShopHandler.java`), not vote points.

### Currency commands and the Maple Admin shop

- `!vp 10000` **sets** the user's total vote points to 10,000 (`User.setVotePoints`); it does not add to the existing balance. Close and reopen the NPC dialogue after changing the balance.
- `!nx <n>` **adds NX Prepaid** through `Char.addNx` → `User.addNXPrepaid`; it does not grant NX Credit or vote points. `!maplepoints <n>` adds Maple Points.
- The user reports that the Nexon button opens a **Maple Admin NPC showing vote points**. Distinguish this custom shop from the Cash Shop handler: adding NX does not change its vote-point balance. For this shop, use `!vp`.
- The local user successfully used `!nx` after account `weebl` was promoted to Admin. Prefer the existing in-game commands for currency changes while playing.
- Pet auto-pickup has not been verified. Before recommending pet or pet-skill items, verify their IDs in `Server/wz/String.wz` and their implementation in the server; do not assume that spawning a pet alone or buying generic pickup skills is sufficient.

## Making the server reachable off-localhost (LAN / Tailscale)

This server was successfully opened to remote players over **Tailscale** (host device `james` = `100.114.235.74`, tailnet `m4pster@gmail.com`). It required FIVE things; missing any one makes remote clients fail in a different, confusing way. Recreate all of them when the server IP changes.

### A. Point the four hardcoded `127.0.0.1` locations at the reachable server IP

1. `auth_hook/Client210/Global.h` → `OPT_ADDR_HOSTNAME` (client login IP). Rebuild `ijl15.dll`, deploy as `Moonlight.dll`.
2. `Server/src/main/java/net/swordie/ms/ServerConstants.java` → `CHANNEL_IP = {b,b,b,b}` (channel IP handed to clients). Java `byte` is signed — octets >127 need a `(byte)` cast (e.g. `235` → `(byte) 235`). Rebuild the server image.
3. `docker-compose.yml` ports → bind `0.0.0.0:` instead of `127.0.0.1:`.
4. `Launcher/v214/main/Client.cs` → `HOST` (the launcher's checksum/token API on 8483). Rebuild the launcher.

Both the launcher **and** the client auth DLL point at the server IP; the launcher's login window does a token request to 8483 *before* the client ever launches, so if 8483 is unreachable the login window just clears the password with no error.

### B. Expose the ports past the WSL2 boundary (`Enable-RemoteAccess.ps1`)

Podman runs in a WSL2 VM. `0.0.0.0` in `docker-compose.yml` only binds *inside* the VM; WSL2 re-publishes the ports on Windows at `127.0.0.1` only (via `wslrelay`), so the Tailscale interface can't reach them. `Enable-RemoteAccess.ps1` (run as admin) adds `netsh portproxy` entries listening on the Tailscale IP → forwarding to `127.0.0.1`, for all 12 ports (8483, 8484, 8585-8594), plus a Windows Firewall inbound allow rule. Re-run it after a reboot or an IP change (`-TailscaleIP <ip>`, `-Remove` to undo).

### C. Grant network access in the Tailscale ACL (easy to miss)

A customized Tailscale ACL that uses `grants`/Taildrive **replaces** the default allow-all, so peer TCP to the game ports is denied unless explicitly granted. Symptom: `tailscale ping james` succeeds and Taildrive works, but `Test-NetConnection <ip> -Port 8484` fails — because `ping` and Taildrive have their own grants while raw TCP does not. Fix: add a connectivity grant to the ACL:

```json
"grants": [
  { "src": ["*"], "dst": ["*"], "ip": ["*"] }
]
```

Diagnose remote reachability with, from the client PC: `tailscale ping james` (tunnel) **and** `Test-NetConnection <serverIP> -Port 8484` (actual port). Ping-yes / TCP-no almost always means the ACL grant is missing.

### D & E. Each remote player needs the rebuilt client + to be on the tailnet

They need the full v214 `client/` folder (~17 GB) containing the **rebuilt** `Moonlight.dll` and launcher, and must be a member of the tailnet. Client distribution was done via **Taildrive** — see below.

## Distributing the 17 GB client over Taildrive

Used to hand the client to remote players without Discord/Drive size limits. Host-side: `tailscale drive share moonlight "F:\Maplestory_PrivateServer_Moonlight\client"`. The ACL needs BOTH a `nodeAttrs` block (`drive:share` on the host, `drive:access` on accessors — grant by email to cover shared/external users) AND a `grants` entry with `tailscale.com/cap/drive` (`"shares": ["*"]`, `"access": "ro"` — read-only also protects the live folder). `Get-MoonlightClient.ps1` is the client-side helper players run as admin.

Windows WebDAV gotchas baked into that script (all required):
- **WebClient service** must be running (`Set-Service WebClient -StartupType Automatic; Start-Service WebClient`).
- **47 MB file-size cap**: raise `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` to `0xFFFFFFFF` (the client has 22 files over the cap, up to ~1.8 GB), then restart WebClient — otherwise large `.wz` copies silently fail.
- **Mount the root, don't hardcode the deep path**: `net use M: \\100.100.100.100@8080\DavWWWRoot` then browse `M:\<tailnet>\<device>\<share>`. The tailnet folder is literally named `m4pster@gmail.com`; embedding that `@` in a deep UNC path breaks the WebDAV redirector (System error 1920). The script auto-discovers `…\james\moonlight`.
- In PowerShell with `ErrorActionPreference=Stop`, never put PowerShell's `2>$null` on a native command — redirect inside cmd (`>nul 2>nul`) or a harmless stderr line (e.g. `net use /delete` when nothing is mapped) becomes a fatal error.

## Building the native/C# components

Toolchain: Visual Studio 2022 Community MSBuild at `C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe`.

```powershell
# Auth hook -> auth_hook/bin/Release/ijl15.dll  (deploy as Moonlight.dll)
MSBuild auth_hook/Client210/Client210.vcxproj /p:Configuration=Release /p:Platform=Win32 /t:Rebuild

# Launcher -> Launcher/v214/bin/Release/Moonlight v214 Launcher.exe
MSBuild Launcher/v214/Launcher.csproj /t:Restore,Rebuild /p:Configuration=Release /p:Platform=AnyCPU
```

After building, deploy `ijl15.dll` (renamed `Moonlight.dll`) and the launcher into both `client/` and `client-overlay/`.

## Conventions

- Match the surrounding code's style; the Java server follows the upstream Swordie conventions.
- NPC/quest logic goes in `Server/scripts/` (Python), not Java, when possible. Scripts are a read-only bind mount (`./Server/scripts` on the host), so host edits appear in the container without rebuilding the image — no `-Rebuild` needed (a server restart may still be required for changes to take effect).
- Don't commit secrets; `.env` holds the local DB credentials by design for this local setup.

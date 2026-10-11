# Local Moonlight setup

Rates: monster EXP 50x, automatic monster meso rewards 100x, monster item drops 25x.
Upstream keeps solo EXP at 1x below level 10. Drop probability is capped at certainty;
25x does not mean 25 copies of each item. Meso reward chance remains 50% per kill.

Validated: Java server build, Windows launcher build, authentication DLL build,
MySQL initialization (84 tables, 9,393 mob drop records), the compiled server's
Hibernate database connection, complete DAT generation, and successful server startup.
All 16 client checksum API requests passed. The login port and all 10 channel ports
returned v214 handshakes. Account creation and in-game character play are left to you.

## Client and data

The client was copied from Steam's v214 depot into this project's `client` directory.
All 16 archives checked by Moonlight match the required hashes and lengths. The
current live Steam installation is separate and incompatible with this server.

For future reinstalls, use Steam's console (`Win+R`, `steam://nav/console`):

```text
download_depot 216150 216151 976750626611673486
```

Steam reports the separate depot download directory when finished. Keep it separate
from the current live client. If Steam rejects the manifest, the client remains a
blocker; do not substitute current-version WZ files.

Use [HaRepacker](https://github.com/lastbattle/Harepacker-resurrected/releases)
to export the v214 WZ archives using **Tools -> Export File(s) To -> Private Server XML**.
Place the exported directories in `Server/wz`, preserving names such as
`Character.wz`, `Map002.wz/Map`, and `String.wz/Skill.img.xml`.

The compiled launcher and auth hook are installed in `client`, with another copy
in `client-overlay`. The launcher expects `Moonlight.dll`, which is the locally
compiled authentication hook.

The local exporter is `tools/WzExport`, using HaRepacker's MapleLib at commit
`4970d339b2ab2bc00ffc33edfbf570e87053b822`. It invokes the same classic XML serializer
with embedded media disabled as HaRepacker's Private Server XML command, and
automatically detects WZ version/encryption (214/BMS for these client files).
Server data is already exported to `Server/wz` and DAT files are generated in the
`moonlight_server_dat` volume. Sound archives remain in the game client; the server
does not load them, and their XML export is excluded because this MapleLib version
rejects one of the legacy audio blocks.

## Run

From PowerShell in this project:

```powershell
./Start-Moonlight.ps1
./Compose.ps1 logs -f server
```

First boot already generated DAT files. The server is currently running. Open
`Play Moonlight.lnk` in the project root (or `client/Moonlight v214 Launcher.exe`).
Accept its administrator prompt, use **Create Account**, then log in and select
**Bera** and a channel. The launcher requires an email field; for this local server,
you can use a syntactically valid local placeholder such as `player@example.com`.
No account has been created automatically. In-game operation has not yet been verified.

After changing rates/source, run `./Start-Moonlight.ps1 -Rebuild`.
Stop with `./Compose.ps1 stop`. This preserves the database and generated DAT volumes.
Allow up to two minutes for shutdown: Moonlight waits 30 seconds, then saves/disconnects
channels in sequence. The Compose grace period covers this instead of killing Java early.
Never use `down -v` or the upstream `Server/init_database.sh` unless intentionally
deleting all accounts and characters. MySQL imports SQL only into a new data volume.

Ports 8483, 8484 and 8585-8594 are bound to localhost; MySQL is internal to the
container network. The local `.env` uses the repository's database credentials,
matching `Server/src/main/java/hibernate.cfg.xml`.

Podman uses the existing `podman-machine-default` VM. `Compose.ps1` uses its Windows
Docker API pipe because the standalone Compose provider does not inherit Podman's
SSH identity configuration.

## Validation logs

- `Server/logs/build.log`: successful Java server/container build.
- `Server/logs/client-copy.log`: complete 17.251 GB client copy, no failed files.
- `Server/logs/wz-export.log`: first export through skills, followed by the unsupported audio block.
- `Server/logs/wz-export-remaining.log`: successful remaining string/UI exports.
- `tools/Verify-Server.ps1`: repeatable checks of the checksum API and all game ports.

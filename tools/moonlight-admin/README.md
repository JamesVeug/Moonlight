# Moonlight Admin Panel (Internal)

Small internal web panel for inspecting and editing selected Moonlight database data.

## What it does

- Login-protected web UI
- Browse Equipment like Hidden Street (Accessory, Armour, Weapon, more)
- Search drops by item name (not just ID)
- Search drops by mob name (not just ID)
- View drops by item ID (fallback)
- View drops by mob ID (fallback)
- Spawn hints by mob ID (from local DB tables)
- Optional server ops button: git pull + rebuild + graceful restart
- Optional restart-only button: graceful restart without pull/build
- Edit `mob_drops` rows with preview + explicit confirmation (guarded by `ALLOW_EDITS`)
- Auto-generate rollback SQL file for each applied edit
- Account rescue helper for stuck-login cleanup steps
- Write an audit log for each change to `tools/moonlight-admin/logs/audit.log`

## Name catalog source

The panel builds a local name index from SQL comments already in this repository:

- `Server/sql/02_Init_Tables_Drops.sql`
- `Server/sql/04_drops.sql`
- `Server/sql/09_InitTables_MonsterCollection.sql`

This keeps the tool self-contained and avoids requiring live WZ parsing in Node.

## Quick start

1. Copy `.env.example` to `.env` and set values.
2. Install dependencies:
   - `npm install`
3. Start server:
   - `npm run start`
4. Open:
   - `http://localhost:8787`

## DB connectivity note

If your MySQL runs inside the compose network only, use your existing helper or expose the DB locally for this tool. Keep this app local/Tailscale-only.

## Safety model

- `ALLOW_EDITS=false`: read-only mode.
- `ALLOW_EDITS=true`: updates enabled for the drop row editor.
- `ALLOW_SERVER_CONTROL=false`: server deploy button disabled.
- `ALLOW_SERVER_CONTROL=true`: enables `/ops/server` deploy workflow.
- Every update appends audit JSON with before/after values and rollback file path.

## Deploy workflow details

Server deploy from `/ops/server` runs:

1. `git pull --ff-only`
2. `podman build` replacement image
3. graceful `podman stop --time 120 moonlight-server`
4. shutdown log marker check (`Accounts have been saved.` + `Shutdown complete!`)
5. `Compose.ps1 up -d --no-build server`

Restart-only from `/ops/server` runs:

1. graceful `podman stop --time 120 moonlight-server`
2. shutdown log marker check (`Accounts have been saved.` + `Shutdown complete!`)
3. `Compose.ps1 up -d --no-build server`

## Stuck "Already Connected" note

The hard lock check is in server runtime memory (`Server.users`), not only DB flags.

- DB-side cleanup is available in the panel (`/account-rescue`), but may not fully clear this lock.
- Runtime fix command (Tester+): `!unstuckuser <username>`

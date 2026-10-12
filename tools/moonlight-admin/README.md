# Moonlight Admin Panel (Internal)

Small internal web panel for inspecting and editing selected Moonlight database data.

## What it does

- Login-protected web UI
- View drops by item ID
- View drops by mob ID
- Spawn hints by mob ID (from local DB tables)
- Edit `mob_drops` rows with preview + explicit confirmation (guarded by `ALLOW_EDITS`)
- Auto-generate rollback SQL file for each applied edit
- Account rescue helper for stuck-login cleanup steps
- Write an audit log for each change to `tools/moonlight-admin/logs/audit.log`

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
- Every update appends audit JSON with before/after values and rollback file path.

## Stuck "Already Connected" note

The hard lock check is in server runtime memory (`Server.users`), not only DB flags.

- DB-side cleanup is available in the panel (`/account-rescue`), but may not fully clear this lock.
- Runtime fix command (Tester+): `!unstuckuser <username>`

# Pi (macOS companion)

This is a tiny macOS app named **Pi** that runs:

1) The **Codex Remote Server** (WebSocket + HTTP) so your phone/web can connect without running any CLI commands.
2) A local **HTTP automation bridge** for UI automation (AppleScript/JXA) with stable macOS permissions.

Why: macOS Accessibility/Automation permissions are granted to **apps**, not random CLI processes. Running AppleScript/JXA **inside this app process** makes permission prompts show up as **Pi**.

## Codex Remote Server (bundled)

- Port: configurable in the app (default `8787`)
- Auth: token required (`CODEX_REMOTE_TOKEN`) — Pi uses the same token as the bridge.
- Health: `GET /health`

## Automation bridge endpoints (local)

- `GET  /mac/health`
- `POST /mac/osascript` `{ script, language?: "AppleScript" | "JavaScript", timeoutMs? }`

Auth: the app requires a token via one of:

- `Authorization: Bearer <token>`
- `x-codex-token: <token>`
- `?token=<token>`

The token is loaded from:

1) Pi app settings (stored in macOS UserDefaults), or
2) fallback: `CODEX_REMOTE_TOKEN` in `/Users/dearphilippe/src/codex-remote-chat/server/.env`

## Permissions

- **Accessibility**: grant in System Settings → Privacy & Security → Accessibility (Pi shows up as “Pi”).
- **Automation**: you can’t “pre‑grant” it. macOS shows the Automation prompt **the first time Pi tries to control an app**.
  - In Pi, click **Request…** next to “Automation (System Events)” and accept the prompt.

## Build

```bash
cd /Users/dearphilippe/src/codex-remote-chat/apps/pi-mac
./build.sh
```

Output: `dist/Pi.app`

## Run

```bash
open dist/Pi.app
```

## Tunnel routing

To expose over your existing Cloudflare Tunnel (`pi.phi.pe`), route:

- `pi.phi.pe/*` → Codex server port (default `8787`)
- `pi.phi.pe/mac/*` → automation bridge port (default `8790`)

in `~/.cloudflared/config.yml`.

Example:

```yml
  - hostname: pi.phi.pe
    path: /mac/*
    service: http://localhost:8790

  - hostname: pi.phi.pe
    service: http://localhost:8787
```

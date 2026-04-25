# phi-codex (Expo + WebSocket + Cloudflare/Tailscale)

Chat UI (Expo + Web) that talks to a Mac-hosted WebSocket server, which proxies requests to your local Codex.app (`codex app-server`) so you can chat with Codex from your phone (with full thread history + workspace browsing).

## 1) Backend (Mac)

From the repo root:

```bash
cd server
cp .env.example .env
# edit .env (optionally set CODEX_REMOTE_TOKEN, etc.)
npm install
npm run dev
```

The server listens on `0.0.0.0:8787` by default.

### Codex app-server

The server connects to `ws://127.0.0.1:8788` by default and will attempt to autostart it via the Codex.app binary.

### Optional: expose your local KB (for Pi / Think)

The server can also expose authenticated KB endpoints (served from your Mac) if you set `KB_CWD` in `server/.env`:

- `GET /kb/health`
- `POST /kb/search` `{ q, limit }`
- `POST /kb/doc` `{ id, maxChars }`

### Tailscale

- Install Tailscale on your Mac + phone and sign into the same tailnet.
- Find your Mac’s Tailscale IP (usually `100.x.y.z`) or MagicDNS name (`tailscale ip -4`).
- Use it as the app WS URL, e.g. `ws://100.x.y.z:8787`.
- If macOS Firewall prompts for Node, allow incoming connections for the server.

Optional: expose/lock down via Tailscale ACLs or `tailscale serve`.

### Cloudflare Tunnel (recommended)

Expose the server over `wss://` so the phone works from any Wi‑Fi/LTE (e.g. `wss://your-codex.example`).

## 2) Mobile app (phone)

```bash
cd apps/mobile
cp .env.example .env
# set EXPO_PUBLIC_WS_URL and (optionally) EXPO_PUBLIC_CODEX_TOKEN
npm install
npm run start
```

Open in Expo Go (or a dev build) and send a message — responses stream in.

## 3) Web UI (shadcn-style, HeroUI-inspired tokens)

This repo also includes a desktop-friendly web UI at `apps/web`, wired to the same WebSocket backend (threads + files + git + streaming chat).

### Dev

```bash
cd apps/web
npm install
npm run dev
```

Then open `http://localhost:3000`. Connection settings are in **Settings**.

### Serve from the backend (recommended for Cloudflare Tunnel)

The backend can serve the exported web build from `apps/web/out`:

```bash
cd apps/web
npm run build  # outputs ./out
```

Then restart the backend; your tunnel domain will serve the web UI if the folder exists.

## Notes

- The phone connects only to your WS server; Codex runs on your Mac.
- Use the same **Client ID** on every device if you want them to sync the same “last active” Codex thread.
- Expo SDK 54 expects a recent Node.js 20.x (or newer). If `expo start` complains, upgrade Node on the Mac.

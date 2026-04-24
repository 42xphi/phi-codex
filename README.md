# Codex Remote Chat (Expo + WS + Tailscale)

ChatGPT-style mobile UI (Expo) that talks to a Mac-hosted WebSocket server, which streams responses from OpenAI.

## 1) Backend (Mac)

From the repo root:

```bash
cd server
cp .env.example .env
# edit .env (OPENAI_API_KEY, CODEX_REMOTE_TOKEN, etc.)
npm install
npm run dev
```

The server listens on `0.0.0.0:8787` by default.

### Tailscale

- Install Tailscale on your Mac + phone and sign into the same tailnet.
- Find your Mac’s Tailscale IP (usually `100.x.y.z`) or MagicDNS name (`tailscale ip -4`).
- Use it as the app WS URL, e.g. `ws://100.x.y.z:8787`.
- If macOS Firewall prompts for Node, allow incoming connections for the server.

Optional: expose/lock down via Tailscale ACLs or `tailscale serve`.

## 2) Mobile app (phone)

```bash
cd apps/mobile
cp .env.example .env
# set EXPO_PUBLIC_WS_URL and EXPO_PUBLIC_CODEX_TOKEN
npm install
npm run start
```

Open in Expo Go (or a dev build) and send a message — responses stream in.

## Notes

- The API key stays on the Mac. The phone connects only to your WS server.
- If you want true “OpenAI Realtime” (upstream WebSocket), the server is structured to swap the OpenAI transport easily.
- Expo SDK 54 expects a recent Node.js 20.x (or newer). If `expo start` complains, upgrade Node on the Mac.

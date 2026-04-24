const fs = require("node:fs");
const path = require("node:path");

const { test, expect } = require("@playwright/test");

function readEnvValue(filePath, key) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m");
        const match = raw.match(re);
        if (!match) return "";
        let value = match[1] ?? "";
        value = value.trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        return value.trim();
    } catch {
        return "";
    }
}

function getServerToken() {
    const envPath = path.join(__dirname, "..", "server", ".env");
    return readEnvValue(envPath, "CODEX_REMOTE_TOKEN");
}

function setupLocalStorage({ page, token, clientId, wsUrl }) {
    return page.addInitScript(
        ({ tokenValue, clientIdValue, wsUrlValue }) => {
            window.localStorage.setItem("codex_remote_ws_url", wsUrlValue);
            window.localStorage.setItem("codex_remote_token", tokenValue);
            window.localStorage.setItem("codex_remote_client_id", clientIdValue);
        },
        { tokenValue: token, clientIdValue: clientId, wsUrlValue: wsUrl },
    );
}

test.describe.configure({ mode: "serial" });

test("renders markdown in chat history", async ({ page }) => {
    const baseUrl = process.env.CODEX_REMOTE_WEB_URL || "http://127.0.0.1:8787";
    const wsUrl = process.env.CODEX_REMOTE_WS_URL || "ws://127.0.0.1:8787";
    const token = process.env.CODEX_REMOTE_TOKEN || getServerToken() || "dev";

    await setupLocalStorage({
        page,
        token,
        clientId: "playwright-expo",
        wsUrl,
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // This history contains a markdown H1 (starts with "# Files mentioned by the user:")
    await expect(
        page
            .getByRole("heading", { name: /^Files mentioned by the user:/ })
            .first(),
    ).toBeVisible();

    // Inline code should render as <code> elements (not raw backticks).
    await expect(page.locator("code").first()).toBeVisible();
});

test("can send and receive a message", async ({ page }) => {
    const baseUrl = process.env.CODEX_REMOTE_WEB_URL || "http://127.0.0.1:8787";
    const wsUrl = process.env.CODEX_REMOTE_WS_URL || "ws://127.0.0.1:8787";
    const token = process.env.CODEX_REMOTE_TOKEN || getServerToken() || "dev";

    await setupLocalStorage({
        page,
        token,
        clientId: "playwright-expo",
        wsUrl,
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    const input = page.getByPlaceholder("Message Codex…");
    await expect(input).toBeVisible({ timeout: 60_000 });

    await input.fill("Reply with exactly: pong");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.locator("text=pong").last()).toBeVisible({
        timeout: 90_000,
    });
});

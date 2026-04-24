export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type OpenAIStreamOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
};

function parseSseEventLines(rawEvent: string): string[] {
  const lines = rawEvent.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) continue;
    dataLines.push(trimmed.slice("data:".length).trimStart());
  }
  return dataLines;
}

export async function* streamChatCompletionsText(
  options: OpenAIStreamOptions,
): AsyncGenerator<string> {
  const { apiKey, baseUrl, model, messages, signal } = options;

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.2,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenAI error (${res.status}): ${text || res.statusText || "unknown"}`,
    );
  }
  if (!res.body) throw new Error("OpenAI: empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = parseSseEventLines(rawEvent);
      for (const data of dataLines) {
        if (data === "[DONE]") return;

        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      }
    }
  }
}


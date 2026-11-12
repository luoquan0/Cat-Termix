import { beforeEach, describe, expect, it, vi } from "vitest";
import { toAnthropicMessages } from "../../../src/backend/providers/anthropic.js";
import { openAiAdapter } from "../../../src/backend/providers/openai.js";
import { geminiAdapter } from "../../../src/backend/providers/gemini.js";
import { ollamaAdapter } from "../../../src/backend/providers/ollama.js";
import type {
  ChatChunk,
  ChatRequest,
} from "../../../src/backend/providers/types.js";

const fetchMock = vi.fn();
const photo = "data:image/webp;base64,aGVsbG8=";
const request: ChatRequest = {
  model: "vision-model",
  system: "Inspect this image.",
  messages: [
    { role: "user", content: "What is shown?", images: [photo] },
    { role: "assistant", content: "A screenshot." },
    { role: "user", content: "And now?" },
  ],
  tools: [],
};

async function collect(generator: AsyncIterable<ChatChunk>) {
  for await (const _part of generator) {
    // Drain the streaming adapter to let it send the request.
  }
}

describe("provider image protocol", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(""));
  });

  it("sends OpenAI multimodal content and leaves text-only turns unchanged", async () => {
    await collect(
      openAiAdapter.streamChat(
        { fetch: fetchMock, providerType: "openai" },
        request,
      ),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.messages[1].content).toEqual([
      { type: "text", text: "What is shown?" },
      { type: "image_url", image_url: { url: photo } },
    ]);
    expect(payload.messages[2]).toEqual({
      role: "assistant",
      content: "A screenshot.",
    });
    expect(payload.messages[3].content).toBe("And now?");
  });

  it("maps images to Anthropic's base64 blocks", () => {
    const messages = toAnthropicMessages(request);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "What is shown?" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/webp",
            data: "aGVsbG8=",
          },
        },
      ],
    });
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "A screenshot.",
    });
  });

  it("sends Gemini inline image data alongside text", async () => {
    await collect(
      geminiAdapter.streamChat(
        { fetch: fetchMock, providerType: "gemini", apiKey: "test" },
        request,
      ),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.contents[0].parts).toEqual([
      { text: "What is shown?" },
      { inlineData: { mimeType: "image/webp", data: "aGVsbG8=" } },
    ]);
    expect(payload.contents[2].parts).toEqual([{ text: "And now?" }]);
  });

  it("passes base64 images to Ollama's images array", async () => {
    await collect(
      ollamaAdapter.streamChat(
        { fetch: fetchMock, providerType: "ollama" },
        request,
      ),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.messages[1]).toMatchObject({
      role: "user",
      content: "What is shown?",
      images: ["aGVsbG8="],
    });
    expect(payload.messages[3]).toEqual({ role: "user", content: "And now?" });
  });
});

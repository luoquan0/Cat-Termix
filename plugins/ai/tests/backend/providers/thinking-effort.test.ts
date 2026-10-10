import { describe, expect, it, vi } from "vitest";
import { openAiAdapter } from "../../../src/backend/providers/openai.js";
import { geminiAdapter } from "../../../src/backend/providers/gemini.js";
import { ollamaAdapter } from "../../../src/backend/providers/ollama.js";

const REQUEST = {
  model: "gpt-6",
  system: "Be concise",
  messages: [{ role: "user" as const, content: "Hello" }],
  tools: [],
};

async function drain(iterable: AsyncIterable<unknown>) {
  for await (const _chunk of iterable) {
    // Request serialization is asserted through the guarded fetch.
  }
}

describe("thinking effort sent to each provider", () => {
  it("sends explicit OpenAI reasoning effort without changing auto requests", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response("data: [DONE]\n\n", { status: 200 }),
      );
    const config = { providerType: "openai" as const, fetch };
    await drain(
      openAiAdapter.streamChat(config, {
        ...REQUEST,
        reasoningEffort: "xhigh",
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      model: "gpt-6",
      reasoning_effort: "xhigh",
    });
    await drain(
      openAiAdapter.streamChat(config, {
        ...REQUEST,
        reasoningEffort: "auto",
      }),
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty(
      "reasoning_effort",
    );
  });

  it("sends a Gemini 2.5 thinking budget and Ollama's explicit thinking switch", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response("", { status: 200 }));
    await drain(
      geminiAdapter.streamChat(
        {
          providerType: "gemini",
          fetch,
          apiKey: "test",
        },
        {
          ...REQUEST,
          model: "gemini-2.5-pro",
          reasoningEffort: "high",
        },
      ),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      generationConfig: { thinkingConfig: { thinkingBudget: 8192 } },
    });

    await drain(
      ollamaAdapter.streamChat(
        { providerType: "ollama", fetch },
        {
          ...REQUEST,
          reasoningEffort: "off",
        },
      ),
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      think: false,
    });
  });
});

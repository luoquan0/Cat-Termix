import { describe, expect, it, vi, afterEach } from "vitest";
import {
  detectModelContext,
  contextFromCompatibleEntry,
  capacityNumber,
} from "../../src/backend/model-context.js";
import { startServer, type TestServer } from "./helpers.js";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("model context discovery", () => {
  it("reads common compatible and nested upstream context fields without interpreting max_tokens as context", () => {
    expect(
      contextFromCompatibleEntry({ context_length: 128000 }),
    ).toMatchObject({ contextWindow: 128000 });
    expect(
      contextFromCompatibleEntry({ model_info: { context_length: 256000 } })
        .contextWindow,
    ).toBe(256000);
    expect(
      contextFromCompatibleEntry({ top_provider: { context_length: 64000 } })
        .contextWindow,
    ).toBe(64000);
    expect(
      contextFromCompatibleEntry({ max_tokens: 999999 }).contextWindow,
    ).toBeNull();
    expect(capacityNumber(50000000)).toBeNull();
    expect(capacityNumber(-1)).toBeNull();
    expect(capacityNumber("256000")).toBe(256000);
  });

  it("prioritizes live gateway metadata over any static specifications", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json({ data: [{ id: "gpt-4.1", context_length: 128000 }] }),
      );
    const context = await detectModelContext(
      {
        providerType: "openai",
        fetch,
      },
      "gpt-4.1",
    );
    expect(context).toMatchObject({
      source: "upstream",
      contextWindow: 128000,
    });
    expect(fetch.mock.calls[0][0]).toContain("/models");
  });

  it("recognizes only documented exact official IDs when upstream omits limits", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json({ data: [{ id: "gpt-4.1" }, { id: "gpt-5.6-luna" }] }),
      );
    expect(
      await detectModelContext({ providerType: "openai", fetch }, "gpt-4.1"),
    ).toMatchObject({
      source: "catalog",
      contextWindow: 1047576,
    });
    expect(
      await detectModelContext(
        {
          providerType: "openai_compatible",
          baseUrl: "https://proxy.example/v1",
          fetch,
        },
        "gpt-4.1",
      ),
    ).toMatchObject({
      source: "unknown",
      contextWindow: null,
    });
    expect(
      await detectModelContext(
        {
          providerType: "openai_compatible",
          baseUrl: "https://proxy.example/v1",
          fetch,
        },
        "gpt-5.6-luna",
      ),
    ).toMatchObject({
      source: "unknown",
      contextWindow: null,
    });
  });

  it("prefers Ollama's configured num_ctx over its advertised theoretical window", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        parameters: "temperature 0.5\nnum_ctx 16384\n",
        model_info: { "llama.context_length": 131072 },
      }),
    );
    const context = await detectModelContext(
      { providerType: "ollama", fetch },
      "llama",
    );
    expect(context).toMatchObject({ source: "upstream", contextWindow: 16384 });
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });

  it("reads Gemini input token caps as a conservative budget", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json({ inputTokenLimit: 1048576, outputTokenLimit: 65536 }),
      );
    const context = await detectModelContext(
      { providerType: "gemini", apiKey: "test", fetch },
      "gemini-2.5-pro",
    );
    expect(context).toMatchObject({
      source: "upstream",
      contextWindow: 1048576,
      maxOutputTokens: 65536,
    });
  });

  it("saves context overrides per user, model and provider; rejects invalid windows", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      json({
        data: [
          { id: "custom", context_length: 256000 },
          { id: "other", context_length: 64000 },
        ],
      }),
    );
    server = await startServer({ fetch });
    await server.enableFor("user-1");
    await server.enableFor("user-2");
    const created = await server.request("POST", "/providers", {
      body: {
        providerType: "openai_compatible",
        label: "Proxy",
        baseUrl: "https://example.org/v1",
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.provider.id;
    const route = "/providers/" + id + "/model-context";
    const discovered = await server.request("GET", route + "?model=custom");
    expect(discovered.status).toBe(200);
    expect(discovered.body).toMatchObject({
      source: "upstream",
      contextWindow: 256000,
    });
    expect(
      (
        await server.request("PUT", route, {
          body: { model: "custom", contextWindow: 128000 },
        })
      ).status,
    ).toBe(200);
    expect(
      (await server.request("GET", route + "?model=custom")).body,
    ).toMatchObject({
      source: "manual",
      contextWindow: 128000,
      manualOverride: 128000,
    });
    expect(
      (await server.request("GET", route + "?model=other")).body,
    ).toMatchObject({
      source: "upstream",
      contextWindow: 64000,
    });
    expect(
      (await server.request("GET", route + "?model=custom", { user: "user-2" }))
        .status,
    ).toBe(404);
    expect(
      (
        await server.request("PUT", route, {
          body: { model: "custom", contextWindow: 1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("PUT", route, {
          body: { model: "custom", contextWindow: null },
        })
      ).status,
    ).toBe(200);
    expect(
      (await server.request("GET", route + "?model=custom")).body,
    ).toMatchObject({
      source: "upstream",
      contextWindow: 256000,
      manualOverride: null,
    });
    expect(
      (await server.request("GET", route + "?model=gpt-5.6-luna")).body,
    ).toMatchObject({
      source: "unknown",
      contextWindow: 32768,
    });
  });
});

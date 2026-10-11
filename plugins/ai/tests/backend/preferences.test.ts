import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("AI user defaults and channel thinking settings", () => {
  it("persists model, channel, thinking and auto-approval per user", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    const created = await server.request("POST", "/providers", {
      body: {
        providerType: "openai",
        label: "Gateway A",
        apiKey: "key-test",
        defaultModel: "gpt-6",
        defaultReasoningEffort: "high",
      },
    });
    expect(created.status).toBe(201);
    const id = created.body.provider.id as number;
    expect(created.body.provider.defaultReasoningEffort).toBe("high");

    const saved = await server.request("PUT", "/preferences", {
      body: {
        providerId: id,
        model: "gpt-6",
        approvalMode: "auto",
        reasoningEffort: "xhigh",
      },
    });
    expect(saved.status).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences,
    ).toMatchObject({
      providerId: id,
      model: "gpt-6",
      approvalMode: "auto",
      reasoningEffort: "xhigh",
      providerEfforts: { [id]: "high" },
    });

    const updated = await server.request("PATCH", `/providers/${id}`, {
      body: { defaultReasoningEffort: "medium" },
    });
    expect(updated.body.provider.defaultReasoningEffort).toBe("medium");
    expect(
      (await server.request("GET", "/providers")).body.providers[0],
    ).toMatchObject({
      id,
      defaultReasoningEffort: "medium",
    });

    await server.enableFor("user-2");
    const other = await server.request("GET", "/preferences", {
      user: "user-2",
    });
    expect(other.body.preferences).toMatchObject({
      providerId: null,
      model: "",
      approvalMode: "review",
      reasoningEffort: "auto",
      providerEfforts: {},
    });
    const forbidden = await server.request("PUT", "/preferences", {
      user: "user-2",
      body: { providerId: id },
    });
    expect(forbidden.status).toBe(404);
  });

  it("rejects unsupported levels, invalid data and client edits to channel defaults", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { reasoningEffort: "ultra-hyper" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { approvalMode: "always_sudo" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { providerEfforts: { "1": "high" } },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/providers", {
          body: {
            providerType: "openai",
            label: "Invalid",
            apiKey: "test",
            defaultReasoningEffort: "invalid",
          },
        })
      ).status,
    ).toBe(400);
    expect((await server.request("GET", "/providers")).body.providers).toEqual(
      [],
    );
  });
});

describe("v12 multi-model channel persistence", () => {
  async function create(label: string, enabledModels?: string[]) {
    return server!.request("POST", "/providers", {
      body: {
        providerType: "openai",
        label,
        apiKey: "private-key-" + label,
        defaultModel: "same",
        ...(enabledModels === undefined ? {} : { enabledModels }),
      },
    });
  }

  it("persists multiple enabled models per channel without exposing API keys", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    const a = await create("A", ["same", "a-only"]);
    const b = await create("B", ["same", "b-only"]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aId = a.body.provider.id as number;
    const bId = b.body.provider.id as number;
    const listed = (await server.request("GET", "/providers")).body.providers;
    expect(
      listed.find((row: { id: number }) => row.id === aId).enabledModels,
    ).toEqual(["same", "a-only"]);
    expect(
      listed.find((row: { id: number }) => row.id === bId).enabledModels,
    ).toEqual(["same", "b-only"]);
    expect(JSON.stringify(listed)).not.toContain("private-key-");
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { providerId: aId, model: "a-only", approvalMode: "auto" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences,
    ).toMatchObject({
      model: "a-only",
      providerModels: { [aId]: ["same", "a-only"], [bId]: ["same", "b-only"] },
    });
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { providerId: bId, model: "a-only" },
        })
      ).status,
    ).toBe(400);
    await server.enableFor("user-2");
    expect(
      (
        await server.request("PATCH", `/providers/${aId}`, {
          user: "user-2",
          body: { enabledModels: ["other"] },
        })
      ).status,
    ).toBe(404);
    expect(
      (await server.request("GET", "/providers", { user: "user-2" })).body
        .providers,
    ).toEqual([]);
  });

  it("removes disabled models from defaults, supports zero enabled models, and keeps legacy discovery", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    const legacy = await create("Legacy");
    expect(legacy.body.provider.enabledModels).toBeNull();
    const created = await create("Configured", ["same", "second"]);
    const id = created.body.provider.id as number;
    await server.request("PUT", "/preferences", {
      body: { providerId: id, model: "same" },
    });
    const patched = await server.request("PATCH", `/providers/${id}`, {
      body: { enabledModels: ["second"] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.provider).toMatchObject({
      enabledModels: ["second"],
      defaultModel: "second",
    });
    expect(
      (await server.request("GET", "/preferences")).body.preferences.model,
    ).toBe("second");
    const empty = await server.request("PATCH", `/providers/${id}`, {
      body: { enabledModels: [] },
    });
    expect(empty.body.provider).toMatchObject({
      enabledModels: [],
      defaultModel: null,
    });
    expect(
      (await server.request("PUT", "/preferences", { body: { model: "same" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await server.request("PUT", "/preferences", {
          body: { providerModels: { [id]: ["same"] } },
        })
      ).status,
    ).toBe(400);
    await server.request("DELETE", `/providers/${id}`);
    expect(
      (await server.request("GET", "/preferences")).body.preferences
        .providerModels,
    ).not.toHaveProperty(String(id));
  });

  it("rejects malformed model lists and disabled default models before writes", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    for (const enabledModels of [
      ["other"],
      [""],
      "not-a-list",
      Array(101).fill("same"),
    ]) {
      const response = await server.request("POST", "/providers", {
        body: {
          providerType: "openai",
          label: "invalid",
          apiKey: "test",
          defaultModel: "same",
          enabledModels,
        },
      });
      expect(response.status).toBe(400);
    }
    expect((await server.request("GET", "/providers")).body.providers).toEqual(
      [],
    );
  });
});

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

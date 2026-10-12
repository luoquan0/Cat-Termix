import { afterEach, describe, expect, it } from "vitest";
import { createAiRepository } from "../../src/backend/repository";
import { normalizeAiPreferences } from "../../src/shared/reasoning";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe("persistent execution mode and per-host active conversations", () => {
  it("defaults safely and normalizes legacy, corrupt and unrelated chat settings", () => {
    expect(normalizeAiPreferences({})).toMatchObject({
      executionMode: "isolated",
      activeConversations: {},
    });
    expect(
      normalizeAiPreferences({
        executionMode: "shared",
        activeConversations: {
          global: 9,
          "1": 10,
          "0": 11,
          other: 12,
          "2": -1,
          "3": "unsafe",
        },
      }),
    ).toMatchObject({
      executionMode: "shared",
      activeConversations: { global: 9, "1": 10 },
    });
    expect(
      normalizeAiPreferences({ executionMode: "bad" }).executionMode,
    ).toBe("isolated");
  });

  it("persists shared execution but rejects invalid or forbidden preferences", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    expect(
      (await server.request("PUT", "/preferences", {
        body: { executionMode: "shared" },
      })).status,
    ).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences,
    ).toMatchObject({ executionMode: "shared" });
    expect(
      (await server.request("PUT", "/preferences", {
        body: { executionMode: "bogus" },
      })).status,
    ).toBe(400);
    expect(
      (await server.request("PUT", "/preferences", {
        body: { activeConversations: { global: 999 } },
      })).status,
    ).toBe(400);
    await server.enableFor("user-2");
    expect(
      (await server.request("GET", "/preferences", { user: "user-2" })).body
        .preferences,
    ).toMatchObject({ executionMode: "isolated", activeConversations: {} });
  });

  it("restores only owned conversations in matching host scopes and clears deleted ones", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    await server.enableFor("user-2");
    const repo = await createAiRepository(server.mock.ctx);
    const hostChat = await repo.createConversation({
      userId: "user-1",
      hostId: 1,
      title: "Terminal chat",
    });
    const globalChat = await repo.createConversation({
      userId: "user-1",
      hostId: null,
      title: "Global chat",
    });
    const ownHost = { hostId: 1, conversationId: hostChat.id };
    const ownGlobal = { hostId: null, conversationId: globalChat.id };
    expect(
      (await server.request("PUT", "/conversations/active", {
        body: ownHost,
      })).status,
    ).toBe(200);
    expect(
      (await server.request("PUT", "/conversations/active", {
        body: ownGlobal,
      })).status,
    ).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences
        .activeConversations,
    ).toEqual({ "1": hostChat.id, global: globalChat.id });
    expect(
      (await server.request("PUT", "/conversations/active", {
        body: { hostId: null, conversationId: hostChat.id },
      })).status,
    ).toBe(404);
    expect(
      (await server.request("PUT", "/conversations/active", {
        user: "user-2",
        body: ownHost,
      })).status,
    ).toBe(404);
    for (const body of [
      { hostId: -1, conversationId: hostChat.id },
      { hostId: "1", conversationId: hostChat.id },
      { hostId: 1, conversationId: 0 },
      { hostId: 1, conversationId: "1" },
      { hostId: 1 },
    ])
      expect(
        (await server.request("PUT", "/conversations/active", { body })).status,
      ).toBe(400);
    expect(
      (await server.request("PUT", "/conversations/active", {
        body: { hostId: 1, conversationId: null },
      })).status,
    ).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences
        .activeConversations,
    ).toEqual({ global: globalChat.id });
    await server.request("PUT", "/conversations/active", { body: ownHost });
    expect(
      (await server.request("DELETE", `/conversations/${hostChat.id}`)).status,
    ).toBe(200);
    expect(
      (await server.request("GET", "/preferences")).body.preferences
        .activeConversations,
    ).toEqual({ global: globalChat.id });
  });
});

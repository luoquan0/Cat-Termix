import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mentionedHostIds,
  terminalOutputTool,
} from "../../src/backend/tools/terminal-output.js";
import type { ToolContext } from "../../src/backend/tools/types.js";
import { availableTools } from "../../src/backend/tools/catalog.js";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});
function response(delta: Record<string, unknown>) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}
function context() {
  const read = vi.fn(async () => ({ status: "available", output: "OK" }));
  const checkAccess = vi.fn(async () => ({ hasAccess: true }));
  return {
    read,
    checkAccess,
    value: {
      userId: "u1",
      conversationId: 1,
      allowReadOnlyCommands: false,
      hostId: 1,
      terminalSessionId: "current",
      deps: {
        hosts: { checkAccess },
        services: {
          providers: () => [""],
          get: () => ({ read }),
        },
      },
    } as unknown as ToolContext,
  };
}
describe("terminal output tool", () => {
  it("resolves exact @host names and IPs, not emails or regex patterns", () => {
    const hosts = [
      { id: 1, name: "web-1", ip: "10.0.0.1" },
      { id: 2, name: "prod [a]", ip: "10.0.0.2" },
    ];
    expect(mentionedHostIds("Check @web-1 now", hosts)).toEqual([1]);
    expect(mentionedHostIds("@10.0.0.2, explain", hosts)).toEqual([2]);
    expect(mentionedHostIds("@prod [a]", hosts)).toEqual([2]);
    expect(mentionedHostIds("mail@web-1 @web-10 @10x0x0x1", hosts)).toEqual([]);
  });
  it("reads the exact current session with no command-execution opt-in", async () => {
    const c = context();
    expect(await terminalOutputTool.handler({}, c.value)).toMatchObject({
      output: "OK",
    });
    expect(c.read).toHaveBeenCalledWith({
      hostId: 1,
      sessionId: "current",
      maxChars: undefined,
    });
  });
  it("prefers an explicit @host and never uses the current host's session for it", async () => {
    const c = context();
    c.value.mentionedHostIds = [2];
    await terminalOutputTool.handler({}, c.value);
    expect(c.read).toHaveBeenCalledWith({
      hostId: 2,
      sessionId: undefined,
      maxChars: undefined,
    });
    c.value.mentionedHostIds = [];
    expect(
      await terminalOutputTool.handler({ hostId: 2 }, c.value),
    ).toHaveProperty("error");
    expect(c.read).toHaveBeenCalledTimes(1);
  });
  it("does not invent output for missing connections or revoked access", async () => {
    const c = context();
    c.value.terminalSessionId = null;
    expect(await terminalOutputTool.handler({}, c.value)).toHaveProperty(
      "status",
      "unavailable",
    );
    expect(c.read).not.toHaveBeenCalled();
    c.value.terminalSessionId = "current";
    c.checkAccess.mockResolvedValue({ hasAccess: false });
    expect(await terminalOutputTool.handler({}, c.value)).toHaveProperty(
      "error",
    );
    expect(c.read).not.toHaveBeenCalled();
  });
  it("is offered only when the optional terminal service is present", () => {
    const off = availableTools(() => false, { allowReadOnlyCommands: false });
    expect(off.some((t) => t.name === "get_terminal_output")).toBe(false);
    const on = availableTools(() => true, { allowReadOnlyCommands: false });
    expect(on.some((t) => t.name === "get_terminal_output")).toBe(true);
  });
  it.each(["isolated", "shared", "mention", "sidebar"])(
    "reads and summarizes in %s mode without copying output into a user message",
    async (mode) => {
      const key = "sk-abcdefghijklmnopqrstuvwx";
      const read = vi.fn(async () => ({
        status: "available",
        output: `Linux\n${key}`,
      }));
      const execute = vi.fn();
      const bodies: Array<{
        messages: Array<{ role: string; content: string }>;
      }> = [];
      server = await startServer({
        services: {
          "terminal.context": { read },
          "terminal.commands": { execute },
        },
        fetch: async (_url, init) => {
          bodies.push(JSON.parse((init as { body: string }).body));
          return response(
            bodies.length === 1
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: "read-1",
                      type: "function",
                      function: {
                        name: "get_terminal_output",
                        arguments: "{}",
                      },
                    },
                  ],
                }
              : { content: "The recent terminal output reports Linux." },
          );
        },
      });
      await server.enableFor("user-1");
      const provider = await server.request("POST", "/providers", {
        body: {
          providerType: "openai",
          label: "Test",
          apiKey: "test",
          defaultModel: "test-model",
        },
      });
      const message =
        mode === "mention"
          ? "@web-1 explain the output"
          : "Explain the current output";
      const reply = await server.request("POST", "/chat/stream", {
        body: {
          message,
          providerId: provider.body.provider.id,
          executionMode: mode === "shared" ? "shared" : "isolated",
          ...(mode === "sidebar"
            ? { terminalContext: { hostId: 1, tabInstanceId: "active-tab" } }
            : mode !== "mention"
              ? { hostId: 1, terminalSessionId: "current" }
              : {}),
        },
      });
      expect(reply.status).toBe(200);
      expect(reply.body).toContain("reports Linux");
      expect(read).toHaveBeenCalledWith({
        hostId: 1,
        sessionId:
          mode === "mention" || mode === "sidebar" ? undefined : "current",
        maxChars: undefined,
        ...(mode === "sidebar" ? { tabInstanceId: "active-tab" } : {}),
      });
      expect(execute).not.toHaveBeenCalled();
      expect(server.mock.sshConnections).toEqual([]);
      expect(bodies[0].messages.filter((m) => m.role === "user")).toEqual([
        { role: "user", content: message },
      ]);
      expect(JSON.stringify(bodies[1].messages)).not.toContain(key);
      expect(JSON.stringify(bodies[1].messages)).toContain("redacted api key");
    },
  );
});

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, ALL_PERMISSIONS, type TestServer } from "./helpers";

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
const call = {
  tool_calls: [
    {
      index: 0,
      id: "call-1",
      type: "function",
      function: {
        name: "propose_run_command",
        arguments: JSON.stringify({
          hostId: 1,
          command: "printf 'healthy'",
          explanation: "Check the requested host",
        }),
      },
    },
  ],
};

async function provider() {
  await server!.enableFor("user-1");
  const created = await server!.request("POST", "/providers", {
    body: {
      providerType: "openai",
      label: "Test",
      apiKey: "sk-test",
      defaultModel: "test-default",
    },
  });
  expect(created.status).toBe(201);
  return created.body.provider.id as number;
}

function ssh(code = 0) {
  const exec = vi.fn(
    (
      _command: string,
      options: unknown,
      cb: (error: null, channel: unknown) => void,
    ) => {
      expect(options).toEqual({ pty: false });
      const channel = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy: vi.fn(),
      });
      cb(null, channel);
      queueMicrotask(() => {
        channel.emit(
          "data",
          Buffer.from(code === 0 ? "healthy" : "permission denied"),
        );
        channel.emit("close", code);
      });
    },
  );
  return { exec, end: vi.fn() };
}

describe("explicit automatic execution", () => {
  it("rejects invalid modes and requires the apply permission", async () => {
    server = await startServer({
      permissions: ALL_PERMISSIONS.filter((p) => p !== "ai.apply_proposals"),
    });
    const providerId = await provider();
    expect(
      (
        await server.request("POST", "/chat/stream", {
          body: { providerId, message: "hi", approvalMode: "anything" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/chat/stream", {
          body: { providerId, message: "hi", approvalMode: "auto" },
        })
      ).status,
    ).toBe(403);
  });

  it("keeps default review mode and never executes a pending proposal", async () => {
    const client = ssh();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(call))
      .mockResolvedValueOnce(response({ content: "Awaiting your approval." }));
    server = await startServer({ fetch, sshClient: client });
    const providerId = await provider();
    const reply = await server.request("POST", "/chat/stream", {
      body: { providerId, message: "check", hostId: 1 },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('"type":"proposal"');
    expect(client.exec).not.toHaveBeenCalled();
  });

  it("executes once in a separate SSH channel, persists the result and sends it back for a summary", async () => {
    const client = ssh();
    const bodies: Record<string, unknown>[] = [];
    let turn = 0;
    server = await startServer({
      sshClient: client,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse((init as { body: string }).body));
        return response(
          turn++ === 0
            ? call
            : { content: "The host check completed successfully: healthy." },
        );
      },
    });
    const providerId = await provider();
    const reply = await server.request("POST", "/chat/stream", {
      body: {
        providerId,
        model: "custom-model",
        message: "check",
        hostId: 1,
        approvalMode: "auto",
      },
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("completed successfully");
    expect(reply.body).not.toContain('"type":"proposal"');
    expect(client.exec).toHaveBeenCalledOnce();
    expect(client.end).not.toHaveBeenCalled();
    expect(server.mock.sshConnections).toEqual([{ host: 1, pool: "ai" }]);
    expect(bodies.every((body) => body.model === "custom-model")).toBe(true);
    expect(JSON.stringify(bodies[1].messages)).toContain("healthy");
    const stored = server.db.sqlite
      .prepare("SELECT status, result_summary FROM p_ai_proposals")
      .get();
    expect(stored).toEqual({ status: "applied", result_summary: "healthy" });
    expect(
      server.mock.audits.some(
        (entry) => entry.action === "ai_proposal_applied" && entry.success,
      ),
    ).toBe(true);
  });

  it("records failure as failure and lets the model explain it", async () => {
    const client = ssh(1);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(call))
      .mockResolvedValueOnce(
        response({ content: "The command failed: permission denied." }),
      );
    server = await startServer({ fetch, sshClient: client });
    const providerId = await provider();
    const reply = await server.request("POST", "/chat/stream", {
      body: { providerId, message: "check", hostId: 1, approvalMode: "auto" },
    });
    expect(reply.body).toContain("command failed");
    const stored = server.db.sqlite
      .prepare("SELECT status, result_summary FROM p_ai_proposals")
      .get() as { status: string; result_summary: string };
    expect(stored.status).toBe("failed");
    expect(stored.result_summary).toContain("permission denied");
    expect(client.exec).toHaveBeenCalledOnce();
  });

  it("summarizes an approved action from the server record with no tools offered", async () => {
    const client = ssh();
    const bodies: { tools?: unknown; messages: unknown }[] = [];
    let turn = 0;
    server = await startServer({
      sshClient: client,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse((init as { body: string }).body));
        return response(
          turn++ === 0 ? call : { content: "Recorded result explained." },
        );
      },
    });
    const providerId = await provider();
    await server.request("POST", "/chat/stream", {
      body: { providerId, message: "check", hostId: 1 },
    });
    const proposal = server.db.sqlite
      .prepare("SELECT id, conversation_id FROM p_ai_proposals")
      .get() as { id: number; conversation_id: number };
    expect(
      (
        await server.request("POST", `/proposals/${proposal.id}/apply`, {
          body: {},
        })
      ).status,
    ).toBe(200);
    const reply = await server.request("POST", "/chat/stream", {
      body: {
        providerId,
        message: "client-claimed-output",
        conversationId: proposal.conversation_id,
        resolvedProposalId: proposal.id,
      },
    });
    expect(reply.body).toContain("Recorded result explained");
    expect(bodies.at(-1)?.tools).toBeUndefined();
    expect(JSON.stringify(bodies.at(-1)?.messages)).toContain("healthy");
    expect(JSON.stringify(bodies.at(-1)?.messages)).not.toContain(
      "client-claimed-output",
    );
    expect(client.exec).toHaveBeenCalledOnce();
  });

  it("refuses inaccessible hosts, invalid host IDs and unresolved result IDs", async () => {
    server = await startServer();
    const providerId = await provider();
    for (const hostId of [-1, 1.5, "1"]) {
      expect(
        (
          await server.request("POST", "/chat/stream", {
            body: { providerId, message: "hi", hostId },
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await server.request("POST", "/chat/stream", {
          body: { providerId, message: "hi", hostId: 987 },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await server.request("POST", "/chat/stream", {
          body: { providerId, message: "hi", resolvedProposalId: 987 },
        })
      ).status,
    ).toBe(400);
  });

  it("prevents concurrent approval from running the command twice", async () => {
    const client = ssh();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(call))
      .mockResolvedValueOnce(response({ content: "Approve to continue" }));
    server = await startServer({ fetch, sshClient: client });
    const providerId = await provider();
    await server.request("POST", "/chat/stream", {
      body: { providerId, message: "check" },
    });
    const { id } = server.db.sqlite
      .prepare("SELECT id FROM p_ai_proposals")
      .get() as { id: number };
    const replies = await Promise.all(
      [1, 2].map(() =>
        server!.request("POST", `/proposals/${id}/apply`, { body: {} }),
      ),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(client.exec).toHaveBeenCalledOnce();
  });
});

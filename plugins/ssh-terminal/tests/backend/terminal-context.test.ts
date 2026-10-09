import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { TerminalSession } from "../../src/backend/session-manager.js";
import { createTerminalContextService } from "../../src/backend/terminal-context.js";

const access = vi.fn();
let actor: string | null;
let sessions: TerminalSession[];
const write = vi.fn();
const service = createTerminalContextService(
  {
    currentActor: () => actor,
    hosts: { checkAccess: access } as unknown as PluginContext["hosts"],
  },
  { getUserSessions: () => sessions },
);
function session(id: string, userId = "u1", hostId = 1): TerminalSession {
  return {
    id,
    userId,
    hostId,
    isConnected: true,
    terminatedByOwner: false,
    createdAt: 1,
    outputBuffer: ["u1$ uname\r\nLinux\r\n"],
    sshStream: { destroyed: false, write },
    participants: new Map(),
  } as unknown as TerminalSession;
}
beforeEach(() => {
  actor = "u1";
  sessions = [session("current")];
  access.mockReset().mockResolvedValue({ hasAccess: true });
  write.mockClear();
});

describe("read-only terminal context", () => {
  it("reads real output and never writes or connects", async () => {
    const result = await service.read({ hostId: 1, sessionId: "current" });
    expect(result).toMatchObject({
      status: "available",
      sessionId: "current",
      output: "u1$ uname\nLinux\n",
    });
    expect(access).toHaveBeenCalledWith(1, "connect");
    expect(write).not.toHaveBeenCalled();
  });
  it("does not leak another user's output or fall back from a stale session", async () => {
    sessions.push(session("foreign", "u2"), session("other-host", "u1", 2));
    for (const sessionId of ["foreign", "other-host", "missing"]) {
      expect(await service.read({ hostId: 1, sessionId })).toMatchObject({
        status: "unavailable",
      });
    }
    expect(await service.read({ hostId: 1 })).toMatchObject({
      sessionId: "current",
    });
  });
  it("requires an authenticated actor and current host access", async () => {
    actor = null;
    expect(await service.read({ hostId: 1 })).toMatchObject({
      status: "unavailable",
    });
    expect(access).not.toHaveBeenCalled();
    actor = "u1";
    access.mockResolvedValue({ hasAccess: false });
    expect(await service.read({ hostId: 1 })).toMatchObject({
      status: "unavailable",
    });
  });
  it("does not return a session closed during the access check", async () => {
    access.mockImplementation(async () => {
      sessions = [];
      return { hasAccess: true };
    });
    expect(await service.read({ hostId: 1 })).toMatchObject({
      status: "unavailable",
    });
  });
  it("returns choices, not mixed output, when a host has several sessions", async () => {
    sessions.push(session("second"));
    const result = await service.read({ hostId: 1 });
    expect(result.status).toBe("ambiguous");
    expect(result).not.toHaveProperty("output");
    expect(
      await service.read({ hostId: 1, sessionId: "second" }),
    ).toMatchObject({ status: "available", sessionId: "second" });
  });
  it("strips split ANSI/OSC sequences and bounds recent output", async () => {
    sessions[0].outputBuffer = [
      "\x1b[31",
      "mold\x1b[0m\r\n",
      "x".repeat(25000),
      "\x1b]0;private title\x07new",
    ];
    const result = await service.read({ hostId: 1, maxChars: 999999 });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing snapshot");
    expect(result.output).toHaveLength(24000);
    expect(result.output.endsWith("new")).toBe(true);
    expect(result.output).not.toContain("\x1b");
    expect(result.output).not.toContain("private title");
    expect(result.truncated).toBe(true);
  });
  it("uses the sidebar's exact tab even with another session on the same host", async () => {
    sessions[0].tabInstanceId = "first-tab";
    const second = session("second");
    second.attachedTabInstanceId = "focused-tab";
    sessions.push(second);
    expect(
      await service.read({ hostId: 1, tabInstanceId: "focused-tab" }),
    ).toMatchObject({ status: "available", sessionId: "second" });
    expect(
      await service.read({ hostId: 1, tabInstanceId: "stale-tab" }),
    ).toMatchObject({ status: "unavailable" });
  });
  it("reports empty output honestly and rejects disconnected sessions", async () => {
    sessions[0].outputBuffer = [];
    expect(await service.read({ hostId: 1 })).toMatchObject({
      status: "available",
      output: "",
    });
    sessions[0].isConnected = false;
    expect(await service.read({ hostId: 1 })).toMatchObject({
      status: "unavailable",
    });
    await expect(service.read({ hostId: -1 })).rejects.toThrow("Invalid host");
  });
});

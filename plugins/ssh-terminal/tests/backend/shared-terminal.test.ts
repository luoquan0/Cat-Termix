import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedTerminalRunner } from "../../src/backend/shared-terminal.js";
import type { TerminalSession } from "../../src/backend/session-manager.js";

function setup() {
  const runner = new SharedTerminalRunner();
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    destroyed: false,
    end: vi.fn(),
    destroy: vi.fn(),
  });
  const session = {
    id: "s1",
    isConnected: true,
    sshStream: stream,
  } as unknown as TerminalSession;
  const busy = vi.fn();
  const ready = () => runner.filterOutput("s1", "\x1b[?2004h$ ");
  const marker = () => {
    const wire = stream.write.mock.calls[0][0] as string;
    const prefix = wire.match(/CAT_AI_[a-f0-9]+/)![0];
    return { begin: `\x1e${prefix}_B\x1f`, end: `\x1e${prefix}_E:` };
  };
  return { runner, stream, session, busy, ready, marker };
}
afterEach(() => vi.useRealTimers());

describe("shared PTY execution", () => {
  it("refuses unknown/busy prompts, partial input, and alternate-screen applications", async () => {
    const t = setup();
    await expect(
      t.runner.execute(t.session, "id", undefined, t.busy),
    ).rejects.toThrow("idle shell prompt");
    t.ready();
    t.runner.input("s1", "unfinished");
    await expect(
      t.runner.execute(t.session, "id", undefined, t.busy),
    ).rejects.toThrow("idle shell prompt");
    t.ready();
    t.runner.filterOutput("s1", "\x1b[?1049h");
    await expect(
      t.runner.execute(t.session, "id", undefined, t.busy),
    ).rejects.toThrow("idle shell prompt");
    expect(t.stream.write).not.toHaveBeenCalled();
  });
  it("handles split markers and only reports success after verified exit and a fresh prompt", async () => {
    const t = setup();
    t.ready();
    const pending = t.runner.execute(
      t.session,
      "echo one\necho two",
      undefined,
      t.busy,
    );
    const m = t.marker();
    expect(t.stream.write.mock.calls[0][0]).not.toContain("\n");
    expect(
      t.runner.filterOutput(
        "s1",
        "encoded wrapper echo" + m.begin.slice(0, 12),
      ),
    ).toBe("");
    let shown = t.runner.filterOutput(
      "s1",
      m.begin.slice(12) + "one\r\ntwo\r\n" + m.end.slice(0, 8),
    );
    shown += t.runner.filterOutput("s1", m.end.slice(8) + "0\x1f");
    expect(t.runner.isReady("s1")).toBe(false);
    t.ready();
    expect(await pending).toEqual({ output: "one\r\ntwo\r\n", code: 0 });
    expect(shown).toContain("[AI] $ echo one\r\n> echo two");
    expect(shown).toContain("one\r\ntwo");
    expect(shown).not.toContain("CAT_AI_");
    expect(shown).not.toContain("encoded wrapper");
    expect(t.busy.mock.calls).toEqual([[true], [false]]);
  });
  it("never closes SSH on cancellation, blocks interleaving, and cannot execute twice concurrently", async () => {
    const t = setup();
    t.ready();
    const pending = t.runner.execute(t.session, "sleep 30", undefined, t.busy);
    await expect(
      t.runner.execute(t.session, "another command", undefined, t.busy),
    ).rejects.toThrow();
    expect(t.runner.input("s1", "\x1b[1;20R")).toBe(true);
    expect(t.runner.input("s1", "human command\r")).toBe(false);
    expect(t.runner.input("s1", "\x03")).toBe(false);
    expect((await pending).error).toContain("Ctrl+C");
    expect(t.stream.write).toHaveBeenCalledTimes(2);
    expect(t.stream.write.mock.calls[1][0]).toBe("\x03");
    expect(t.stream.end).not.toHaveBeenCalled();
    expect(t.stream.destroy).not.toHaveBeenCalled();
    expect(t.runner.isReady("s1")).toBe(false);
    t.ready();
    expect(t.runner.isReady("s1")).toBe(true);
  });
  it("caps model output, preserves non-zero exit status and times out safely", async () => {
    const t = setup();
    t.ready();
    const p = t.runner.execute(t.session, "generate", undefined, t.busy);
    const m = t.marker();
    t.runner.filterOutput(
      "s1",
      m.begin + "x".repeat(100_000) + m.end + "7\x1f\x1b[?2004h",
    );
    const r = await p;
    expect(r.code).toBe(7);
    expect(r.error).toContain("Exited with code 7");
    expect(r.output.length).toBeLessThan(66_000);
    expect(r.output).toContain("truncated");
    vi.useFakeTimers();
    const timed = t.runner.execute(
      t.session,
      "sleep 30",
      undefined,
      t.busy,
      10,
    );
    await vi.advanceTimersByTimeAsync(11);
    expect((await timed).error).toContain("timed out");
    expect(t.stream.end).not.toHaveBeenCalled();
  });
  it("rejects control injection and cancels on disconnect or caller abort", async () => {
    const t = setup();
    t.ready();
    await expect(
      t.runner.execute(t.session, "echo ok\x1b[31m", undefined, t.busy),
    ).rejects.toThrow("control");
    const controller = new AbortController();
    const p = t.runner.execute(
      t.session,
      "sleep 30",
      controller.signal,
      t.busy,
    );
    controller.abort();
    expect((await p).error).toContain("Stopped");
    t.ready();
    const closed = t.runner.execute(t.session, "sleep 30", undefined, t.busy);
    t.stream.emit("close");
    expect((await closed).error).toContain("connection ended");
  });
  it.skipIf(process.platform !== "linux")(
    "runs multiline commands inside a real Bash PTY and keeps it alive after exit and Ctrl+C",
    async () => {
      const runner = new SharedTerminalRunner();
      const child = spawn(
        "script",
        ["-q", "-c", "bash --noprofile --norc -i", "/dev/null"],
        {
          env: {
            ...process.env,
            TERM: "xterm-256color",
            INPUTRC: "/dev/null",
            PS1: "CAT_TEST$ ",
          },
        },
      );
      const stream = Object.assign(new EventEmitter(), {
        destroyed: false,
        write: (data: string) => child.stdin.write(data),
      });
      const session = {
        id: "real",
        isConnected: true,
        sshStream: stream,
      } as unknown as TerminalSession;
      let visible = "";
      child.stdout.on("data", (data: Buffer) => {
        visible += runner.filterOutput("real", data.toString());
      });
      child.on("close", () => stream.emit("close"));
      const ready = async () => {
        for (let n = 0; n < 200; n++) {
          if (runner.isReady("real")) return;
          await new Promise((r) => setTimeout(r, 15));
        }
        throw new Error("No Bash prompt");
      };
      try {
        await ready();
        runner.input("real", "cd /tmp\r");
        child.stdin.write("cd /tmp\r");
        await ready();
        const r = await runner.execute(
          session,
          "pwd\nprintf 'line two\\n'\nexit 7",
          undefined,
          () => {},
          4000,
        );
        expect(r.code).toBe(7);
        expect(r.output).toContain("/tmp");
        expect(r.output).toContain("line two");
        expect(visible).toContain("[AI] $");
        expect(visible).not.toContain("CAT_AI_");
        const p = runner.execute(
          session,
          "sleep 30",
          undefined,
          () => {},
          4000,
        );
        await new Promise((r) => setTimeout(r, 100));
        runner.input("real", "\x03");
        expect((await p).error).toContain("Ctrl+C");
        await ready();
        const next = await runner.execute(
          session,
          "echo still-connected",
          undefined,
          () => {},
          4000,
        );
        expect(next.code).toBe(0);
        expect(next.output).toContain("still-connected");
      } finally {
        runner.forget("real");
        child.stdin.write("exit\r");
        child.kill("SIGTERM");
      }
    },
    15_000,
  );
});

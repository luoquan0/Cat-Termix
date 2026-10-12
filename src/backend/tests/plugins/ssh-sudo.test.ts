import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runSudoCommand, sudoCommandLine } from "../../plugins/ssh-sudo";

function fakeClient() {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    end: vi.fn(),
    close: vi.fn(),
  });
  const client = {
    exec: vi.fn(
      (
        _command: string,
        callback: (error: Error | null, stream: unknown) => void,
      ) => callback(null, channel),
    ),
  };
  return { client, channel };
}

describe("core-owned sudo exec", () => {
  it("passes only the password over SSH stdin and makes the root command's stdin empty", async () => {
    const f = fakeClient();
    const password = "VERY_PRIVATE_'_SUDO_PASS";
    const command = "id -u; printf '%s' done";
    const running = runSudoCommand(f.client as never, command, password, {
      onStdout: vi.fn(),
      onStderr: vi.fn(),
    });
    const argv = f.client.exec.mock.calls[0][0];
    expect(argv).toContain("sudo -k -S -p '' -- sh -c");
    expect(argv).toContain("exec 0</dev/null;");
    expect(argv).not.toContain(password);
    expect(argv).toBe(sudoCommandLine(command));
    expect(f.channel.end).toHaveBeenCalledWith(password + "\n");
    f.channel.emit("exit", 0);
    f.channel.emit("close");
    expect(await running).toEqual({ exitCode: 0 });
  });

  it("escapes embedded single quotes and reports nonzero failures", async () => {
    const f = fakeClient();
    const running = runSudoCommand(
      f.client as never,
      "printf '%s' '$HOME'",
      "password",
    );
    const cmd = f.client.exec.mock.calls[0][0];
    expect(cmd).toContain("'\\''");
    expect(cmd).not.toContain("password");
    f.channel.emit("exit", 1);
    f.channel.emit("close");
    expect(await running).toEqual({ exitCode: 1 });
  });

  it("rejects invalid requests and aborts the remote SSH channel on cancellation", async () => {
    const f = fakeClient();
    await expect(
      runSudoCommand(f.client as never, "", "secret"),
    ).rejects.toThrow("INVALID_SUDO_COMMAND");
    await expect(
      runSudoCommand(f.client as never, "id", "bad\nsecret"),
    ).rejects.toThrow("SUDO_PASSWORD_NOT_CONFIGURED");
    await expect(
      runSudoCommand(f.client as never, "id", "secret", {
        timeoutMs: 4,
      }),
    ).rejects.toThrow("INVALID_SUDO_TIMEOUT");
    expect(f.client.exec).not.toHaveBeenCalled();
    const abort = new AbortController();
    const running = runSudoCommand(f.client as never, "sleep 20", "secret", {
      signal: abort.signal,
    });
    abort.abort();
    await expect(running).rejects.toThrow("canceled");
    expect(f.channel.close).toHaveBeenCalledOnce();
  });
});

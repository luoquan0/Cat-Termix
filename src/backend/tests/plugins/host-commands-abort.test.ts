import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execCommand, type Client } from "@termix/plugin-sdk/host-commands";

afterEach(() => vi.useRealTimers());
function fixture(immediate = true) {
  const stream = Object.assign(new EventEmitter(), {stderr: new EventEmitter(), destroy: vi.fn()});
  let open: ((error: null, channel: unknown) => void) | undefined;
  const client = {end: vi.fn(), exec: vi.fn((_command: string, _options: unknown, cb: typeof open) => {
    open = cb;
    if (immediate) cb?.(null, stream);
  })};
  return {stream, client, run: (options = {}) => execCommand(client as unknown as Client, "uptime", 1000, options), open: () => open?.(null, stream)};
}

describe("independent cancellable SSH execution", () => {
  it("does not open a channel for an already aborted run", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.run({signal: controller.signal})).rejects.toThrow("interrupted");
    expect(f.client.exec).not.toHaveBeenCalled();
  });
  it("closes only its own non-PTY channel, never the shared SSH client", async () => {
    const f = fixture(); const controller = new AbortController();
    const pending = f.run({signal: controller.signal}); controller.abort();
    await expect(pending).rejects.toThrow("interrupted");
    expect(f.client.exec).toHaveBeenCalledWith("uptime", {pty:false}, expect.any(Function));
    expect(f.stream.destroy).toHaveBeenCalledOnce();
    expect(f.client.end).not.toHaveBeenCalled();
  });
  it("destroys a late channel that arrives after cancellation", async () => {
    const f = fixture(false); const controller = new AbortController();
    const pending = f.run({signal: controller.signal}); controller.abort();
    await expect(pending).rejects.toThrow("interrupted");
    f.open(); expect(f.stream.destroy).toHaveBeenCalledOnce();
  });
  it("bounds combined stdout and stderr and reports truncation", async () => {
    const f = fixture(); const pending = f.run({maxOutputBytes:5});
    f.stream.emit("data", Buffer.from("abcd"));
    f.stream.stderr.emit("data", Buffer.from("efgh"));
    f.stream.emit("data", Buffer.from("ijkl"));
    f.stream.emit("close", 0);
    expect(await pending).toEqual({stdout:"abcd", stderr:"e\n[output truncated]\n", code:0});
  });
  it("times out without disconnecting the user's client", async () => {
    vi.useFakeTimers(); const f = fixture();
    const pending = expect(f.run()).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(1000); await pending;
    expect(f.stream.destroy).toHaveBeenCalledOnce();
    expect(f.client.end).not.toHaveBeenCalled();
  });
});

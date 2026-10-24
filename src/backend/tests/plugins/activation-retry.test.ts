import { describe, expect, it } from "vitest";
import { shouldRetryTimedOutBundledPlugin } from "../../plugins/index.js";

describe("plugin restart after an automatic activation timeout", () => {
  const agent = { id: "agent", source: "bundled" as const };
  const timedOut = {
    state: "failed",
    lastError: "Plugin agent did not activate within 30000ms",
  };

  it("retries a previously enabled bundled plugin after a loader timeout", () => {
    expect(shouldRetryTimedOutBundledPlugin(agent, timedOut)).toBe(true);
  });

  it("never reenables administrator-disabled or user-installed plugins", () => {
    expect(
      shouldRetryTimedOutBundledPlugin(agent, {
        ...timedOut,
        state: "disabled",
      }),
    ).toBe(false);
    expect(
      shouldRetryTimedOutBundledPlugin(
        { id: "agent", source: "user" },
        timedOut,
      ),
    ).toBe(false);
  });

  it("does not retry unrelated plugin errors or a different plugin identity", () => {
    expect(
      shouldRetryTimedOutBundledPlugin(agent, {
        state: "failed",
        lastError: "database is locked",
      }),
    ).toBe(false);
    expect(
      shouldRetryTimedOutBundledPlugin(
        { id: "other", source: "bundled" },
        timedOut,
      ),
    ).toBe(false);
  });
});

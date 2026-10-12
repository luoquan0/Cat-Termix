import { describe, expect, it } from "vitest";
import {
  getCapabilityInfo,
  mayAutoGrantBundledCapability,
} from "@termix/plugin-sdk/capabilities";

describe("sudo capability is opt-in even for bundled plugins", () => {
  it("requires a deliberate administrator grant for root execution", () => {
    expect(getCapabilityInfo("ssh:sudo")?.risk).toBe("critical");
    expect(mayAutoGrantBundledCapability("ssh:sudo")).toBe(false);
    expect(mayAutoGrantBundledCapability("ssh:connect")).toBe(true);
    expect(mayAutoGrantBundledCapability("credentials:use")).toBe(true);
  });
});

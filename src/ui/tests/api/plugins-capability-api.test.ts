import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  post: vi.fn(async () => ({ data: { granted: true } })),
  delete: vi.fn(async () => ({ data: { granted: false } })),
}));
vi.mock("@/main-axios", () => ({ rbacApi: api }));

import {
  grantPluginCapability,
  revokePluginCapability,
} from "@/api/plugins-api";

describe("plugin capability grant API", () => {
  it("uses the existing authenticated core grant endpoint", async () => {
    await grantPluginCapability("agent", "ssh:sudo");
    expect(api.post).toHaveBeenCalledWith("/plugins/agent/grants", {
      capability: "ssh:sudo",
    });
  });
  it("uses the revocation endpoint and encodes colon-separated capabilities", async () => {
    await revokePluginCapability("agent", "ssh:sudo");
    expect(api.delete).toHaveBeenCalledWith("/plugins/agent/grants/ssh%3Asudo");
  });
});
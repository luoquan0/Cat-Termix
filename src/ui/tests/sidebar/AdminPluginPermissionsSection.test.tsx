import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPluginPermissionsSection } from "@/sidebar/AdminPluginPermissionsSection";

const api = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  grantPluginCapability: vi.fn(),
  revokePluginCapability: vi.fn(),
}));

vi.mock("@/api/plugins-api", () => api);
const translate = vi.hoisted(() => (key: string) => key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let sudoGranted = false;
function agent() {
  return {
    id: "agent",
    name: "Local Agent",
    state: "active",
    enabled: true,
    capabilities: ["ssh:sudo"],
    grantedCapabilities: sudoGranted ? ["ssh:sudo"] : [],
    contributes: null,
  };
}
function renderSection() {
  return render(<AdminPluginPermissionsSection open onToggle={() => {}} />);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  sudoGranted = false;
  api.getPlugins.mockImplementation(async () => [agent()]);
  api.grantPluginCapability.mockImplementation(async () => {
    sudoGranted = true;
  });
  api.revokePluginCapability.mockImplementation(async () => {
    sudoGranted = false;
  });
});

describe("administrator plugin capability management", () => {
  it("shows the missing Local Agent sudo capability and requires a critical confirmation", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("ssh:sudo");

    await user.click(
      screen.getByRole("button", { name: "admin.pluginCapabilities.grant" }),
    );
    expect(api.grantPluginCapability).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "admin.pluginCapabilities.confirm" }),
    );
    await waitFor(() =>
      expect(api.grantPluginCapability).toHaveBeenCalledWith(
        "agent",
        "ssh:sudo",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("admin.pluginCapabilities.granted")).toBeTruthy(),
    );
  });

  it("revokes an existing sudo grant without another approval", async () => {
    sudoGranted = true;
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("ssh:sudo");
    await user.click(
      screen.getByRole("button", { name: "admin.pluginCapabilities.revoke" }),
    );
    await waitFor(() =>
      expect(api.revokePluginCapability).toHaveBeenCalledWith(
        "agent",
        "ssh:sudo",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText("admin.pluginCapabilities.notGranted"),
      ).toBeTruthy(),
    );
  });

  it("does not optimistically show a critical grant when the API fails", async () => {
    api.grantPluginCapability.mockRejectedValue(new Error("denied"));
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("ssh:sudo");
    await user.click(
      screen.getByRole("button", { name: "admin.pluginCapabilities.grant" }),
    );
    await user.click(
      screen.getByRole("button", { name: "admin.pluginCapabilities.confirm" }),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(
      screen.getByText("admin.pluginCapabilities.notGranted"),
    ).toBeTruthy();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;
let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  cleanup();
  await rendered?.deactivate();
  rendered = null;
});

describe("Local Agent frontend navigation", () => {
  it("registers a real sidebar panel for its rail icon and a standalone tab", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: async (path: string) => ({
          data: path === "/admin/devices" ? { devices: [] } : { projects: [] },
        }),
      } as never,
    });

    expect(rendered.registered.railItems().map((item) => item.id)).toContain(
      "agent",
    );
    expect(rendered.registered.panels()).toContain("agent");
    expect(rendered.registered.tabs()).toContain("agent");
    expect(
      rendered.registered.extensions("system.adminSettings.sections"),
    ).toContain("agent-lan-http");

    const panel = rendered.renderPanel("agent");
    expect(panel.querySelector("h2")).not.toBeNull();
    expect(panel.querySelector("section")).not.toBeNull();
  });

  it("unregisters the panel, tab and rail item after the plugin is disabled", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    await rendered.deactivate();
    expect(rendered.registered.panels()).not.toContain("agent");
    expect(rendered.registered.tabs()).not.toContain("agent");
    expect(
      rendered.registered.railItems().map((item) => item.id),
    ).not.toContain("agent");
  });
});

describe("copying the Local Agent install command", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const originalExecCommand = Object.getOwnPropertyDescriptor(
    document,
    "execCommand",
  );

  function setClipboard(writeText?: (value: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  }

  function setLegacyCopy(result: boolean) {
    const execute = vi.fn(() => result);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execute,
    });
    return execute;
  }

  afterEach(() => {
    if (originalClipboard)
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (originalExecCommand)
      Object.defineProperty(document, "execCommand", originalExecCommand);
    else Reflect.deleteProperty(document, "execCommand");
  });

  async function showPanel() {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: async (path: string) => ({
          data: path === "/admin/devices" ? { devices: [] } : { projects: [] },
        }),
      } as never,
    });
    rendered.renderPanel("agent");
    return screen.getByRole("button", { name: "Copy" });
  }

  it("uses the modern Clipboard API and confirms success", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    const button = await showPanel();
    fireEvent.click(button);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("auth login --url"),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Copied to clipboard",
    );
  });

  it("copies on insecure HTTP where navigator.clipboard does not exist", async () => {
    setClipboard();
    const copy = setLegacyCopy(true);
    const button = await showPanel();
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledWith("copy");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Copied to clipboard",
    );
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports failure instead of silently pretending the copy worked", async () => {
    setClipboard(async () => {
      throw new Error("clipboard permission denied");
    });
    setLegacyCopy(false);
    const button = await showPanel();
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Copy failed. Select the command and copy it manually.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("editing a paired local client", () => {
  it("changes scopes and future host selection in place, then removes the revoked row", async () => {
    let devices = [
      {
        id: "client-one",
        name: "My client",
        fingerprint: "test-fingerprint",
        accessMode: "selected",
        projectIds: ["folder:bGFi"],
        scopes: ["files:read"],
        maxConcurrentSessions: 1,
        expiresAt: null,
        revokedAt: null,
      },
    ];
    const patch = vi.fn(async () => ({ data: { device: devices[0] } }));
    const remove = vi.fn(async () => {
      devices = [];
      return { data: { revoked: true } };
    });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: async (path: string) => ({
          data:
            path === "/admin/devices"
              ? { devices }
              : {
                  projects: [{ id: "folder:bGFi", name: "lab", hostIds: [1] }],
                },
        }),
        patch,
        delete: remove,
      } as never,
    });
    rendered.renderPanel("agent");
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit permissions" }),
    );
    const future = screen.getByRole("checkbox", {
      name: "Include future hosts in the selected folders",
    }) as HTMLInputElement;
    expect(future.checked).toBe(false);
    fireEvent.click(future);
    fireEvent.click(screen.getByRole("checkbox", { name: "files:write" }));
    fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        "/admin/devices/client-one",
        expect.objectContaining({
          includeFutureHosts: true,
          scopes: ["files:read", "files:write"],
        }),
      ),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await waitFor(() =>
        expect(
          (screen.getByRole("button", { name: "Revoke" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
      await waitFor(() => expect(screen.queryByText("My client")).toBeNull());
      expect(remove).toHaveBeenCalledWith("/admin/devices/client-one");
    } finally {
      confirm.mockRestore();
    }
  });
});

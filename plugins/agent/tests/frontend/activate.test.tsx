import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
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
          data:
            path === "/admin/devices"
              ? { devices: [] }
              : { projects: [] },
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
    expect(rendered.registered.railItems().map((item) => item.id)).not.toContain(
      "agent",
    );
  });
});

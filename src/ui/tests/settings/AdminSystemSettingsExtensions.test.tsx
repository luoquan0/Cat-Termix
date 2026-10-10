import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  registerExtension,
  resetExtensions,
} from "@/plugin-host/extension-registry";
import {
  AdminSystemSettingsExtensions,
  SYSTEM_ADMIN_SETTINGS_POINT,
} from "@/settings/AdminSystemSettingsExtensions";

afterEach(() => {
  cleanup();
  resetExtensions();
});

describe("administrator system settings extensions", () => {
  it("mounts software update controls only in system settings and unregisters on deactivation", () => {
    render(<AdminSystemSettingsExtensions />);
    expect(screen.queryByTestId("global-update-panel")).toBeNull();
    let unregister = () => {};
    act(() => {
      unregister = registerExtension(SYSTEM_ADMIN_SETTINGS_POINT, {
        id: "software-updates",
        pluginId: "ai",
        components: {
          section: () => <section data-testid="global-update-panel">Software updates</section>,
        },
      });
    });
    expect(screen.getByTestId("global-update-panel").textContent).toBe("Software updates");
    act(() => unregister());
    expect(screen.queryByTestId("global-update-panel")).toBeNull();
  });

  it("ignores extensions that do not register a section", () => {
    act(() => {
      registerExtension(SYSTEM_ADMIN_SETTINGS_POINT, {
        id: "incomplete",
        pluginId: "ai",
      });
    });
    const { container } = render(<AdminSystemSettingsExtensions />);
    expect(container.textContent).toBe("");
  });
});

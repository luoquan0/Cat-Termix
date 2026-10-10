import type { ComponentType } from "react";
import { useExtensions } from "@/plugin-host/extension-registry";

/**
 * System-wide administrator settings supplied by a plugin. Core renders only
 * complete, registered sections; the plugin may hide its own section if the
 * administrator lacks the section-specific capability.
 *
 * Plugin lifecycle owns registration and cleanup, so no AI chat dependency.
 */
export const SYSTEM_ADMIN_SETTINGS_POINT = "system.adminSettings.sections";

export function AdminSystemSettingsExtensions() {
  const sections = useExtensions(SYSTEM_ADMIN_SETTINGS_POINT);
  return (
    <>
      {sections.map((entry) => {
        if (!entry.pluginId || !entry.id) return null;
        const components = entry.components as
          { section?: ComponentType } | undefined;
        const Section = components?.section;
        if (!Section) return null;
        return <Section key={`${entry.pluginId}:${entry.id}`} />;
      })}
    </>
  );
}

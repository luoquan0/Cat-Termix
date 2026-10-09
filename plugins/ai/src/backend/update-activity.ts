import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PluginContext } from "@termix/plugin-sdk/backend";
export const activeAiRequests = new Set<symbol>();
export async function maintenance(
  ctx: PluginContext,
): Promise<{ id: string } | null> {
  if (process.env.CAT_TERMIX_UPDATER_ENABLED !== "1") return null;
  try {
    const raw = JSON.parse(
      await readFile(
        path.join(await ctx.files.dataDir(), "updates", "maintenance.json"),
        "utf8",
      ),
    );
    return typeof raw.id === "string" &&
      Date.now() - Date.parse(raw.at) < 30 * 60 * 1000
      ? raw
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

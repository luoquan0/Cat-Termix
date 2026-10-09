import { activeAiRequests, maintenance } from "./update-activity.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  DEFAULT_UPDATE_POLICY,
  validateUpdatePolicy,
} from "../shared/update-policy.js";

/** No Docker socket or updater command execution is ever exposed to the AI process. */
export function registerUpdateSettings(router: Router, ctx: PluginContext) {
  const canManage = async () =>
    (await ctx.rbac.has("admin.settings.manage")) &&
    (await ctx.rbac.has("manage_updates"));
  const folder = async () => {
    const dir = path.join(await ctx.files.dataDir(), "updates");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  };
  async function read(name: string) {
    try {
      return JSON.parse(
        await readFile(path.join(await folder(), name), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async function write(name: string, data: unknown) {
    const file = path.join(await folder(), name);
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, file);
  }
  if (process.env.CAT_TERMIX_UPDATER_ENABLED === "1") {
    const tick = async () => {
      const pending = await maintenance(ctx);
      await write("activity.json", {
        activeRequests: activeAiRequests.size,
        maintenanceId: pending?.id ?? null,
        heartbeat: new Date().toISOString(),
      });
    };
    const timer = setInterval(() => void tick().catch(() => undefined), 3000);
    timer.unref();
    ctx.disposables.add(() => clearInterval(timer));
  }
  router.get("/updates", async (_req, res) => {
    if (!(await canManage())) return res.json({ canManage: false });
    try {
      const policy = validateUpdatePolicy(
        (await read("config.json")) ?? DEFAULT_UPDATE_POLICY,
      );
      const status = await read("status.json");
      const installed = Boolean(
        status?.heartbeat && Date.now() - Date.parse(status.heartbeat) < 180000,
      );
      res.json({
        canManage: true,
        installed,
        // A saved authenticated proxy is never reflected into the browser or logs.
        policy: {
          ...policy,
          proxyUrl: policy.proxyUrl ? new URL(policy.proxyUrl).origin : "",
        },
        proxyConfigured: Boolean(policy.proxyUrl),
        status,
      });
    } catch {
      res.status(500).json({ error: "Could not read updater state" });
    }
  });
  router.put(
    "/updates",
    ctx.rbac.require("manage_updates") as never,
    async (req, res) => {
      if (!(await canManage()))
        return res
          .status(403)
          .json({ error: "Administrator permission required" });
      try {
        const previous = validateUpdatePolicy(
          (await read("config.json")) ?? DEFAULT_UPDATE_POLICY,
        );
        const input = {
          ...req.body,
          proxyUrl:
            req.body?.keepProxy === true
              ? previous.proxyUrl
              : req.body?.proxyUrl,
        };
        const policy = validateUpdatePolicy(input);
        await write("config.json", policy);
        await ctx.audit.record({
          action: "update_settings_changed",
          resourceType: "application",
          resourceId: "cat-termix",
          success: true,
          details: JSON.stringify({
            enabled: policy.enabled,
            intervalHours: policy.intervalHours,
            proxyEnabled: Boolean(policy.proxyUrl),
          }),
        });
        res.json({ success: true });
      } catch {
        res.status(400).json({
          error: "Invalid update settings or settings could not be saved",
        });
      }
    },
  );
  router.post(
    "/updates/check",
    ctx.rbac.require("manage_updates") as never,
    async (_req, res) => {
      if (!(await canManage()))
        return res
          .status(403)
          .json({ error: "Administrator permission required" });
      await write("request.json", {
        id: randomUUID(),
        action: "check",
        at: new Date().toISOString(),
      });
      res.status(202).json({ accepted: true });
    },
  );
  router.post(
    "/updates/apply",
    ctx.rbac.require("manage_updates") as never,
    async (req, res) => {
      if (!(await canManage()))
        return res
          .status(403)
          .json({ error: "Administrator permission required" });
      if (req.body?.confirmRestart !== true)
        return res
          .status(400)
          .json({ error: "Confirm restart and temporary SSH disconnection" });
      await ctx.audit.record({
        action: "application_update_requested",
        resourceType: "application",
        resourceId: "cat-termix",
        success: true,
      });
      await write("request.json", {
        id: randomUUID(),
        action: "apply",
        at: new Date().toISOString(),
      });
      res.status(202).json({ accepted: true });
    },
  );
}

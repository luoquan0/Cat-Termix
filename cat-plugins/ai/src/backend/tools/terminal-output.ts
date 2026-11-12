import type { PluginHostSummary } from "@termix/plugin-sdk/backend";
import { readService, SERVICE } from "../services.js";
import { num, str, objectSchema, type AiTool } from "./types.js";

/** Resolve @ names/IPs without executing or trusting a model-supplied user id. */
export function mentionedHostIds(
  message: string,
  hosts: readonly Pick<PluginHostSummary, "id" | "name" | "ip">[],
): number[] {
  return hosts
    .filter((host) =>
      [host.name, host.ip].some((label) => {
        if (!label) return false;
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(
          `(?:^|\\s)@${escaped}(?=$|[\\s,;:!?\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A])`,
          "i",
        ).test(message);
      }),
    )
    .map((host) => host.id);
}

export const terminalOutputTool: AiTool = {
  name: "get_terminal_output",
  description:
    "Read recent actual output of the user's open SSH terminal without running any command. For questions about current terminal errors or @host output, use this tool instead of asking the user to paste/attach output. Defaults to the current terminal or a single @host; use list_hosts to resolve a named host. If several sessions exist, select a returned sessionId or ask which terminal. Command history is not terminal output.",
  category: "read",
  service: SERVICE.terminalContext,
  parameters: objectSchema({
    hostId: num("Host id; optional for the current terminal or a single @host"),
    sessionId: str(
      "Optional session id returned by this tool when multiple sessions exist",
    ),
    maxChars: num("Recent output character limit (default 12000, max 24000)"),
  }),
  handler: async (args, context) => {
    const references = context.mentionedHostIds ?? [];
    const currentHostId = context.hostId ?? context.terminalHostId;
    const hostId =
      args.hostId ??
      (references.length === 1
        ? references[0]
        : references.length > 1
          ? undefined
          : currentHostId);
    if (
      typeof hostId !== "number" ||
      !Number.isSafeInteger(hostId) ||
      hostId <= 0
    )
      return {
        error: "Specify a host id from list_hosts, or open chat on a terminal",
      };
    if (
      context.hostId !== undefined &&
      hostId !== context.hostId &&
      !references.includes(hostId)
    )
      return {
        error:
          "This host is neither the current terminal nor an @host reference",
      };
    if (!(await context.deps.hosts.checkAccess(hostId, "connect")).hasAccess)
      return { error: "Host not found" };
    if (
      args.sessionId !== undefined &&
      (typeof args.sessionId !== "string" || !args.sessionId.trim())
    )
      return { error: "Invalid terminal session id" };
    if (
      hostId === context.hostId &&
      args.sessionId === undefined &&
      context.terminalSessionId === null
    )
      return {
        status: "unavailable",
        reason: "The current terminal is not connected",
      };
    const result = await readService(
      context.deps.services,
      SERVICE.terminalContext,
      (terminal) =>
        terminal.read({
          hostId,
          sessionId:
            typeof args.sessionId === "string"
              ? args.sessionId
              : hostId === currentHostId
                ? (context.terminalSessionId ?? undefined)
                : undefined,
          ...(hostId === currentHostId && context.terminalTabInstanceId
            ? { tabInstanceId: context.terminalTabInstanceId }
            : {}),
          maxChars:
            typeof args.maxChars === "number" ? args.maxChars : undefined,
        }),
    );
    return (
      result ?? {
        status: "unavailable",
        reason:
          "Terminal output service is unavailable or access is denied. Do not invent output or request a manual attachment; explain that no readable session is available.",
      }
    );
  },
};

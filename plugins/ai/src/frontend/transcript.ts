import type { AiMessage, AiProposal } from "./ai-api";
import type { StreamState, ToolActivity } from "./use-ai-stream";

/** A finished part of the conversation, kept after the stream resets. */
export type HistoryEntry =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "tool"; tool: ToolActivity };

/** One entry in the rendered conversation, in the order it happened. */
export type TimelineItem =
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant";
      content: string;
    }
  /** live is false for a past run's step, which can never still be running. */
  | { kind: "tool"; key: string; tool: ToolActivity; live: boolean }
  | { kind: "proposal"; key: string; proposal: AiProposal };

export function userEntry(content: string): HistoryEntry {
  return { kind: "message", role: "user", content };
}

/**
 * What a finished run leaves in the transcript: its tool steps, then its
 * reply. Tool ids are only unique within one run, so they get a run prefix.
 */
export function finishedRunEntries(
  runId: number,
  tools: ToolActivity[],
  reply: string,
): HistoryEntry[] {
  const entries: HistoryEntry[] = tools.map((tool) => ({
    kind: "tool",
    tool: { ...tool, id: `run-${runId}-${tool.id}` },
  }));
  if (reply)
    entries.push({ kind: "message", role: "assistant", content: reply });
  return entries;
}

/** Past runs, then the run in progress, then its proposals. */
export function buildTimeline(
  history: HistoryEntry[],
  state: Pick<StreamState, "tools" | "assistantText">,
  proposals: AiProposal[],
): TimelineItem[] {
  const timeline: TimelineItem[] = history.map((entry, index) =>
    entry.kind === "tool"
      ? { kind: "tool", key: entry.tool.id, tool: entry.tool, live: false }
      : {
          kind: "message",
          key: `history-${index}`,
          role: entry.role,
          content: entry.content,
        },
  );

  for (const tool of state.tools) {
    timeline.push({ kind: "tool", key: tool.id, tool, live: true });
  }

  if (state.assistantText) {
    timeline.push({
      kind: "message",
      key: "streaming",
      role: "assistant",
      content: state.assistantText,
    });
  }

  const remaining = new Map(
    proposals.map((proposal) => [proposal.id, proposal]),
  );
  const ordered: TimelineItem[] = [];
  for (const item of timeline) {
    ordered.push(item);
    if (item.kind !== "tool") continue;
    const result = item.tool.result as { proposalId?: number } | undefined;
    const linkedId = item.tool.proposalId ?? result?.proposalId;
    const proposal =
      linkedId !== undefined
        ? remaining.get(linkedId)
        : [...remaining.values()].find((candidate) => {
            if (candidate.kind !== item.tool.name) return false;
            try {
              const payload = JSON.parse(candidate.payload) as Record<
                string,
                unknown
              >;
              return Object.entries(item.tool.arguments).every(
                ([key, value]) =>
                  JSON.stringify(payload[key]) === JSON.stringify(value),
              );
            } catch {
              return false;
            }
          });
    if (proposal) {
      ordered.push({
        kind: "proposal",
        key: `proposal-${proposal.id}`,
        proposal,
      });
      remaining.delete(proposal.id);
    }
  }
  // Legacy rows may lack tool linkage. Still keep them above the latest answer.
  const lastReply = ordered.findLastIndex(
    (item) => item.kind === "message" && item.role === "assistant",
  );
  ordered.splice(
    lastReply < 0 ? ordered.length : lastReply,
    0,
    ...[...remaining.values()].map((proposal): TimelineItem => ({
      kind: "proposal",
      key: `proposal-${proposal.id}`,
      proposal,
    })),
  );

  return ordered;
}

/**
 * Reconstruct a saved run from server-stored rows. Assistant tool calls and
 * tool results are separate rows; preserving their relative order makes the
 * same conversation readable after reload without inventing tool outcomes.
 */
export function savedConversationEntries(
  messages: readonly AiMessage[],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const callPositions = new Map<string, number>();

  const decodeCalls = (raw: string | null): Record<string, unknown>[] => {
    try {
      const result: unknown = JSON.parse(raw ?? "[]");
      return Array.isArray(result)
        ? result.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object",
          )
        : [];
    } catch {
      return [];
    }
  };

  for (const message of messages) {
    if (message.role === "user") {
      // The internal resolution prompt contains server action details, not
      // something the user actually typed.
      const internal = message.content.startsWith(
        "Explain this server-recorded action outcome in the user's language.",
      );
      entries.push(
        userEntry(internal ? "Summarize the action result" : message.content),
      );
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.trim()) {
        entries.push({
          kind: "message",
          role: "assistant",
          content: message.content,
        });
      }
      for (const [index, call] of decodeCalls(message.toolCalls).entries()) {
        if (typeof call.name !== "string") continue;
        const id = typeof call.id === "string" ? call.id : String(index);
        const args =
          call.arguments &&
          typeof call.arguments === "object" &&
          !Array.isArray(call.arguments)
            ? (call.arguments as Record<string, unknown>)
            : {};
        callPositions.set(id, entries.length);
        entries.push({
          kind: "tool",
          tool: {
            id: ["saved", message.id, id].join("-"),
            name: call.name,
            arguments: args,
          },
        });
      }
      continue;
    }

    if (message.role === "tool") {
      const call = decodeCalls(message.toolCalls)[0];
      const position =
        typeof call?.id === "string" ? callPositions.get(call.id) : undefined;
      if (position === undefined) continue;
      const previous = entries[position];
      if (previous?.kind !== "tool") continue;
      let result: unknown = message.content;
      try {
        result = JSON.parse(message.content);
      } catch {
        // Output can be plain terminal text.
      }
      entries[position] = {
        kind: "tool",
        tool: { ...previous.tool, result },
      };
    }
  }

  return entries;
}

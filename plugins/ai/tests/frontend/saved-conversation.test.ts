import { describe, expect, it } from "vitest";
import { savedConversationEntries } from "../../src/frontend/transcript";
import type { AiMessage } from "../../src/frontend/ai-api";

function row(id: number, role: AiMessage["role"], content: string, toolCalls: string | null = null): AiMessage {
  return { id, conversationId: 1, role, content, toolCalls, createdAt: "" };
}

describe("saved AI transcript", () => {
  it("restores replies, command results, and ordering", () => {
    const entries = savedConversationEntries([
      row(1, "user", "Check disk space"),
      row(2, "assistant", "", JSON.stringify([{ id: "call1", name: "read_host", arguments: { hostId: 3 } }])),
      row(3, "tool", '{"free":42}', JSON.stringify([{ id: "call1", name: "read_host" }])),
      row(4, "assistant", "42 GB free"),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: "message", role: "user" });
    expect(entries[1]).toMatchObject({ kind: "tool", tool: { name: "read_host", result: { free: 42 } } });
    expect(entries[2]).toMatchObject({ kind: "message", content: "42 GB free" });
  });

  it("does not display server resolution instructions or invent missing results", () => {
    const entries = savedConversationEntries([
      row(1, "user", "Explain this server-recorded action outcome in the user's language.\\nStatus: failed"),
      row(2, "assistant", "Pending", JSON.stringify([{ id: "x", name: "propose_run_command", arguments: {} }])),
      row(3, "tool", "irrelevant", "not-json"),
    ]);
    expect(entries[0]).toMatchObject({ kind: "message", content: "Summarize the action result" });
    expect(entries[2]).toMatchObject({ kind: "tool", tool: { name: "propose_run_command" } });
    const pending = entries[2];
    if (pending.kind !== "tool") throw new Error("Expected tool");
    expect("result" in pending.tool).toBe(false);
  });
});

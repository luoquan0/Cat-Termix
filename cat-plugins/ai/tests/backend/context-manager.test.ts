import { describe, expect, it, vi } from "vitest";
import {
  ContextManager,
  estimateRequestTokens,
  isContextOverflow,
} from "../../src/backend/context-manager";
import {
  contextPolicy,
  DEFAULT_CONTEXT_POLICY,
  estimateTextTokens,
} from "../../src/shared/context-policy";
import { toChatHistory } from "../../src/backend/history";
import type {
  ChatMessage,
  ProviderAdapter,
} from "../../src/backend/providers/types";

const policy = {
  ...DEFAULT_CONTEXT_POLICY,
  contextWindow: 8192,
  outputReserve: 1024,
  keepRecentTurns: 1,
};
const config = { providerType: "openai_compatible" as const, fetch: vi.fn() };
const oldHistory = (): ChatMessage[] => [
  {
    storedId: 1,
    role: "user",
    content: "Inspect host 7 at /srv/app; do not delete anything.",
  },
  {
    storedId: 2,
    role: "assistant",
    content: "",
    toolCalls: [{ id: "run1", name: "inspect", arguments: { hostId: 7 } }],
  },
  {
    storedId: 3,
    role: "tool",
    toolCallId: "run1",
    content: "old log ".repeat(4500),
  },
  {
    storedId: 4,
    role: "assistant",
    content: "Disk pressure, no changes made.",
  },
  {
    storedId: 5,
    role: "user",
    content: "Continue investigating, no deletion.",
  },
];
const adapter = (
  text = "Host 7: /srv/app. No deletion allowed. Inspection only; disk pressure found. Continue diagnosis.",
): ProviderAdapter => ({
  async *streamChat(_config, request) {
    expect(request.tools).toEqual([]);
    yield { type: "text", text };
  },
  listModels: async () => [],
});
describe("context budgets and durable compaction", () => {
  it("includes tool schemas and non-ASCII text in the estimate", () => {
    expect(estimateTextTokens("\u4e2d\u6587")).toBeGreaterThan(
      estimateTextTokens("ab"),
    );
    expect(
      estimateRequestTokens(
        "sys",
        [{ role: "user", content: "hello" }],
        [{ name: "test", description: "schema".repeat(100), parameters: {} }],
      ),
    ).toBeGreaterThan(
      estimateRequestTokens("sys", [{ role: "user", content: "hello" }], []),
    );
    expect(() => contextPolicy({ ...policy, outputReserve: 8192 })).toThrow();
    expect(() => contextPolicy({ ...policy, threshold: 99 })).toThrow();
  });
  it("summarizes older turns, keeps protocol pairs and never modifies source rows", async () => {
    const history = oldHistory(),
      original = structuredClone(history),
      save = vi.fn();
    const manager = new ContextManager(history, policy);
    expect(manager.needsCompaction("sys", [])).toBe(true);
    await manager.prepare({
      system: "sys",
      tools: [],
      adapter: adapter(),
      config,
      model: "model",
      save,
    });
    expect(history).toEqual(original);
    expect(manager.messages).toEqual([history[4]]);
    expect(manager.checkpoint.throughId).toBe(4);
    expect(manager.history()[0].content).toContain("untrusted");
    expect(manager.usage("sys", []).percent).toBeLessThan(75);
    expect(save).toHaveBeenCalledTimes(1);
    const resumed = new ContextManager(history, policy, manager.checkpoint);
    expect(resumed.messages).toEqual([history[4]]);
  });
  it("keeps the previous checkpoint on empty or failed summaries", async () => {
    const save = vi.fn();
    const history = oldHistory();
    const manager = new ContextManager(history, policy);
    await expect(
      manager.prepare({
        system: "sys",
        tools: [],
        adapter: adapter(""),
        config,
        model: "m",
        save,
      }),
    ).rejects.toThrow(/empty summary/);
    expect(save).not.toHaveBeenCalled();
    expect(manager.messages).toEqual(history);
    expect(manager.checkpoint.throughId).toBe(0);
  });
  it("does not save on cancellation and never executes summarizer tool calls", async () => {
    const controller = new AbortController(),
      save = vi.fn();
    controller.abort();
    const manager = new ContextManager(oldHistory(), policy);
    await expect(
      manager.prepare({
        system: "sys",
        tools: [],
        adapter: adapter(),
        config,
        model: "m",
        save,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/interrupted/);
    const malicious: ProviderAdapter = {
      listModels: async () => [],
      async *streamChat() {
        yield {
          type: "tool_call",
          call: { id: "x", name: "run", arguments: {} },
        };
      },
    };
    await expect(
      manager.prepare({
        system: "sys",
        tools: [],
        adapter: malicious,
        config,
        model: "m",
        save,
      }),
    ).rejects.toThrow(/nothing was executed/);
    expect(save).not.toHaveBeenCalled();
  });
  it("preserves current tool pairs and explicitly shortens a huge current result", async () => {
    const history = oldHistory().slice(0, 4);
    const manager = new ContextManager(history, policy);
    await manager.prepare({
      system: "sys",
      tools: [],
      adapter: adapter(),
      config,
      model: "m",
    });
    expect(manager.messages[1].toolCalls?.[0].id).toBe("run1");
    expect(manager.messages[2].toolCallId).toBe("run1");
    expect(manager.messages[2].content).toContain("Context copy shortened");
    expect(history[2].content).not.toContain("Context copy shortened");
  });
  it("blocks an oversized latest user request instead of silently dropping it", async () => {
    const manager = new ContextManager(
      [{ role: "user", content: "x".repeat(40000) }],
      policy,
    );
    await expect(
      manager.prepare({
        system: "sys",
        tools: [],
        adapter: adapter(),
        config,
        model: "m",
      }),
    ).rejects.toThrow(/current request/);
  });
  it("recognizes only context overflow for a bounded retry", () => {
    expect(isContextOverflow(new Error("context_length_exceeded"))).toBe(true);
    expect(isContextOverflow(new Error("API key rejected"))).toBe(false);
    expect(isContextOverflow(new Error("rate limit"))).toBe(false);
  });
  it("does not resurrect an interrupted synthetic tool result after a checkpoint", () => {
    const rows = [
      { id: 1, role: "user", content: "check", toolCalls: null },
      {
        id: 2,
        role: "assistant",
        content: "",
        toolCalls: JSON.stringify([
          { id: "pending", name: "check", arguments: {} },
        ]),
      },
      { id: 3, role: "user", content: "next", toolCalls: null },
    ];
    const saved = {
      version: 1 as const,
      throughId: 2,
      summary: "Prior check interrupted",
      compactions: 1,
      policy,
    };
    const manager = new ContextManager(toChatHistory(rows), policy, saved);
    expect(manager.messages).toHaveLength(1);
    expect(manager.messages[0].content).toBe("next");
  });
});

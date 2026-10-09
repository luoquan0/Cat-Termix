import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  finishedRunEntries,
  userEntry,
} from "../../src/frontend/transcript";

describe("finishedRunEntries", () => {
  it("keeps the run's tool steps ahead of its reply", () => {
    const entries = finishedRunEntries(
      2,
      [{ id: "tool-0", name: "list_hosts", arguments: {}, result: [] }],
      "done",
    );
    expect(entries).toEqual([
      {
        kind: "tool",
        tool: {
          id: "run-2-tool-0",
          name: "list_hosts",
          arguments: {},
          result: [],
        },
      },
      { kind: "message", role: "assistant", content: "done" },
    ]);
  });

  it("adds no empty reply", () => {
    expect(finishedRunEntries(0, [], "")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  it("keeps past steps when a new run starts", () => {
    const history = [
      userEntry("check"),
      ...finishedRunEntries(
        0,
        [{ id: "tool-0", name: "list_hosts", arguments: {} }],
        "",
      ),
      userEntry("continue"),
    ];
    const timeline = buildTimeline(
      history,
      {
        tools: [{ id: "tool-0", name: "get_host", arguments: {} }],
        assistantText: "hi",
      },
      [],
    );

    expect(timeline.map((item) => item.kind)).toEqual([
      "message",
      "tool",
      "message",
      "tool",
      "message",
    ]);
    const tools = timeline.filter((item) => item.kind === "tool");
    expect(tools.map((item) => item.live)).toEqual([false, true]);
    expect(new Set(timeline.map((item) => item.key)).size).toBe(
      timeline.length,
    );
  });
});

it("anchors approval cards before later summaries instead of pinning old cards to the bottom", () => {
  const proposal = {
    id: 7,
    conversationId: 1,
    kind: "propose_run_command",
    summary: "Check",
    payload: JSON.stringify({ hostId: 1, command: "df -h" }),
    status: "applied" as const,
    resultSummary: "Healthy",
    createdAt: "",
  };
  const history = [
    userEntry("check"),
    ...finishedRunEntries(
      0,
      [
        {
          id: "t1",
          name: "propose_run_command",
          arguments: { hostId: 1, command: "df -h" },
          proposalId: 7,
        },
      ],
      "Waiting",
    ),
    userEntry("summarize"),
    ...finishedRunEntries(1, [], "The disk is healthy"),
  ];
  const timeline = buildTimeline(history, { tools: [], assistantText: "" }, [
    proposal,
  ]);
  expect(timeline.findIndex((x) => x.kind === "proposal")).toBe(2);
  expect(timeline.at(-1)).toMatchObject({
    kind: "message",
    content: "The disk is healthy",
  });
});

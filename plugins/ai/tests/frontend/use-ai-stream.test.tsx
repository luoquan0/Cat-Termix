import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAiStream } from "../../src/frontend/use-ai-stream";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../src/frontend/app-ref", () => ({ aiApp: () => api }));
afterEach(cleanup);
beforeEach(() => api.fetch.mockReset());
function sse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { status: 200 },
  );
}
describe("chat stream lifecycle", () => {
  it("sends model, host binding and explicit mode and retains proposal cards on follow-up", async () => {
    const proposal = {
      id: 1,
      conversationId: 7,
      status: "pending",
      kind: "propose_run_command",
      payload: "{}",
      summary: "check",
      resultSummary: null,
      createdAt: "",
    };
    api.fetch
      .mockResolvedValueOnce(
        sse([
          { type: "conversation", conversationId: 7 },
          { type: "proposal", proposal },
        ]),
      )
      .mockResolvedValueOnce(sse([{ type: "token", text: "Finished" }]));
    const { result } = renderHook(useAiStream);
    await act(async () => {
      await result.current.send({
        message: "hi",
        providerId: 2,
        model: "custom",
        hostId: 3,
        approvalMode: "auto",
      });
    });
    const body = JSON.parse(api.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: "custom",
      hostId: 3,
      approvalMode: "auto",
    });
    await act(async () => {
      await result.current.send({
        message: "summarize",
        providerId: 2,
        conversationId: 7,
        resolvedProposalId: 1,
      });
    });
    expect(result.current.state.proposals).toEqual([proposal]);
    expect(JSON.parse(api.fetch.mock.calls[1][1].body).approvalMode).toBe(
      "review",
    );
  });
  it("aborts a request when its panel unmounts", async () => {
    api.fetch.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(useAiStream);
    act(() => {
      void result.current.send({ message: "hi", providerId: 1 });
    });
    const signal = api.fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
  it("does not let an old response restore a reset conversation", async () => {
    let finish: (response: Response) => void = () => {};
    api.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(useAiStream);
    let pending: Promise<void>;
    act(() => {
      pending = result.current.send({ message: "hi", providerId: 1 });
    });
    act(() => result.current.reset());
    await act(async () => {
      finish(sse([{ type: "conversation", conversationId: 9 }]));
      await pending!;
    });
    expect(result.current.state.conversationId).toBeNull();
    expect(result.current.state.streaming).toBe(false);
  });
});

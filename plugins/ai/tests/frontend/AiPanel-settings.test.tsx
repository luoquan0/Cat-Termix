import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AiPanel } from "../../src/frontend/AiPanel";

vi.mock("../../src/frontend/UpdateSettings", () => ({
  UpdateSettings: () => null,
}));
const api = vi.hoisted(() => ({
  t: (key: string) => key,
  getAiProviders: vi.fn(),
  getAiProviderModels: vi.fn(),
  getAiModelContext: vi.fn(),
  saveAiModelContextOverride: vi.fn(),
  getAiStatus: vi.fn(),
  getAiConversations: vi.fn(),
  getAiConversation: vi.fn(),
  deleteAiConversation: vi.fn(),
  setAiOptIn: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("../../src/frontend/ai-api", () => api);
vi.mock("../../src/frontend/app-ref", () => ({ aiApp: () => api }));
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: api.t }),
}));
vi.mock("../../src/frontend/useMentions", () => ({
  activeMentionQuery: () => null,
  useMentions: () => ({ search: () => [] }),
}));
vi.mock("../../src/frontend/AiProviderSettings", () => ({
  AiProviderSettings: () => <div>Provider editor</div>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.getAiProviders.mockResolvedValue([
    {
      id: 1,
      providerType: "openai",
      label: "Upstream",
      defaultModel: "auto-model",
      enabled: true,
    },
  ]);
  api.getAiProviderModels.mockResolvedValue(["auto-model"]);
  api.getAiModelContext.mockResolvedValue({
    providerId: 1,
    model: "auto-model",
    contextWindow: 128000,
    detectedWindow: 128000,
    source: "upstream",
    detectedSource: "upstream",
    manualOverride: null,
    maxOutputTokens: null,
    detail: null,
    referenceUrl: null,
  });
  api.saveAiModelContextOverride.mockResolvedValue(undefined);
  api.getAiStatus.mockResolvedValue({ globallyEnabled: true, enabled: true });
  api.getAiConversations.mockResolvedValue([]);
  api.fetch.mockImplementation(
    async () =>
      new Response(
        'data: {"type":"conversation","conversationId":7}\n\ndata: {"type":"token","text":"Hello"}\n\n',
      ),
  );
});
afterEach(cleanup);
async function ready() {
  const composer = (await screen.findByPlaceholderText(
    "ai.inputPlaceholder",
  )) as HTMLTextAreaElement;
  await waitFor(() => expect(api.getAiProviderModels).toHaveBeenCalled());
  return composer;
}
describe("compact chat settings and a clean composer", () => {
  it("starts empty, hides configuration and has no terminal attachment action", async () => {
    const sessionId = vi.fn(() => "current");
    render(<AiPanel hostId={1} getTerminalSessionId={sessionId} />);
    const composer = await ready();
    expect(composer.value).toBe("");
    expect(sessionId).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("ai.attachTerminalOutput")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const settings = screen.getByRole("button", { name: "ai.chatSettings" });
    expect(
      screen.getByRole("button", { name: "ai.history" }).nextElementSibling,
    ).toBe(settings);
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(settings);
    expect(
      screen.getByRole("dialog", { name: "ai.chatSettings" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "ai.executionMode" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "ai.modelPicker" }),
    ).toBeTruthy();
    expect(screen.getByText("ai.providerSettings")).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "ai.chatSettings" });
    expect(dialog.closest("[data-slot=dialog-content]")).toBeTruthy();
    expect(composer.closest("[role=dialog]")).toBeNull();
  });
  it("can send with settings closed and new chats never paste terminal text", async () => {
    render(<AiPanel hostId={1} getTerminalSessionId={() => "current"} />);
    const composer = await ready();
    fireEvent.change(composer, {
      target: { value: "Explain the current terminal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(api.fetch.mock.calls[0][1].body)).toMatchObject({
      message: "Explain the current terminal",
      model: "auto-model",
      hostId: 1,
      terminalSessionId: "current",
      executionMode: "isolated",
    });
    await screen.findByText("Hello");
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    expect(composer.value).toBe("");
    expect(screen.queryByText("Hello")).toBeNull();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not reset model or automatic mode when closing settings", async () => {
    api.getAiProviders.mockResolvedValue([
      { id: 1, label: "Upstream", enabled: true, defaultModel: null },
    ]);
    api.getAiProviderModels.mockResolvedValue([]);
    render(<AiPanel />);
    const composer = await ready();
    const settings = screen.getByRole("button", { name: "ai.chatSettings" });
    fireEvent.click(settings);
    fireEvent.change(screen.getByLabelText("ai.modelPicker"), {
      target: { value: "my-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("ai.autoModeCompact")).toBeTruthy();
    fireEvent.change(composer, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalled());
    expect(JSON.parse(api.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "my-model",
      approvalMode: "auto",
    });
  });
});

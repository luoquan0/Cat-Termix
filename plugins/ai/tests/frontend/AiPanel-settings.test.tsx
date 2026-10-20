import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AiPanel } from "../../src/frontend/AiPanel";

const api = vi.hoisted(() => ({
  t: (key: string) => key,
  AI_PROVIDERS_CHANGED_EVENT: "termix-ai:providers-changed",
  getAiProviders: vi.fn(),
  getAiPreferences: vi.fn(),
  saveAiPreferences: vi.fn(),
  saveActiveAiConversation: vi.fn(),
  updateAiProvider: vi.fn(),
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
  api.getAiPreferences.mockResolvedValue({
    providerId: 1,
    model: "auto-model",
    approvalMode: "review",
    reasoningEffort: "auto",
    providerEfforts: {},
    providerModels: { "1": ["auto-model"] },
  });
  api.saveAiPreferences.mockResolvedValue({});
  api.saveActiveAiConversation.mockResolvedValue(undefined);
  api.updateAiProvider.mockImplementation(
    async (id: number, patch: { enabledModels: string[] }) => ({
      id,
      providerType: "openai",
      label: "Upstream",
      baseUrl: null,
      apiKeyPrefix: null,
      enabled: true,
      createdAt: "",
      enabledModels: patch.enabledModels,
      defaultModel: patch.enabledModels[0] ?? null,
    }),
  );
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
const oldScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);
beforeAll(() =>
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  }),
);
afterAll(() => {
  if (oldScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", oldScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
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
    // The SDK test host intentionally returns a fresh translation function on
    // every render. That must not re-run setup or provider discovery forever.
    expect(api.getAiStatus).toHaveBeenCalledTimes(1);
    expect(sessionId).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText("ai.attachTerminalOutput")).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
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
      within(screen.getByRole("dialog", { name: "ai.chatSettings" })).getByRole(
        "checkbox",
        { name: "auto-model" },
      ),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("dialog", { name: "ai.chatSettings" }),
      ).queryByRole("combobox", { name: "ai.modelPicker" }),
    ).toBeNull();
    expect(screen.getByText("ai.providerSettings")).toBeTruthy();
    expect(screen.queryByText("ai.updateSettings")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "ai.chatSettings" });
    expect(dialog.closest("[data-slot=dialog-content]")).toBeTruthy();
    expect(dialog.className).toContain("overflow-x-hidden");
    expect(dialog.className).toContain("max-w-[900px]");
    expect(composer.closest("[role=dialog]")).toBeNull();
  });
  it("uploads an image, sends it with text, and keeps its preview in chat", async () => {
    render(<AiPanel />);
    const composer = await ready();
    const picker = screen.getByLabelText("ai.addImages") as HTMLInputElement;
    const file = new File(["image-data"], "screenshot.png", {
      type: "image/png",
    });
    fireEvent.change(picker, { target: { files: [file] } });
    await screen.findByAltText("ai.attachedImage 1");

    fireEvent.change(composer, { target: { value: "What does this show?" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));

    await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(api.fetch.mock.calls[0][1].body);
    expect(body.message).toBe("What does this show?");
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatch(/^data:image\/png;base64,/);
    await screen.findByAltText("Attached image 1");
  });

  it("can send images alone and restore the draft when HTTP rejects it", async () => {
    api.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Image format not supported" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<AiPanel />);
    await ready();
    const picker = screen.getByLabelText("ai.addImages") as HTMLInputElement;
    fireEvent.change(picker, {
      target: {
        files: [new File(["png-data"], "screen.png", { type: "image/png" })],
      },
    });
    await screen.findByAltText("ai.attachedImage 1");
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(api.fetch.mock.calls[0][1].body).message).toBe(
      "ai.describeImages",
    );
    await screen.findByAltText("ai.attachedImage 1");
    expect(screen.getByText("Image format not supported")).toBeTruthy();
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
    api.getAiPreferences.mockResolvedValue({
      providerId: 1,
      model: "",
      approvalMode: "review",
      reasoningEffort: "auto",
      providerEfforts: {},
      providerModels: {},
    });
    render(<AiPanel />);
    const composer = await ready();
    const settings = screen.getByRole("button", { name: "ai.chatSettings" });
    fireEvent.click(settings);
    const modal = screen.getByRole("dialog", { name: "ai.chatSettings" });
    fireEvent.change(
      within(modal).getByRole("textbox", { name: "ai.addCustomModelId" }),
      { target: { value: "my-model" } },
    );
    fireEvent.click(within(modal).getByRole("button", { name: "ai.addModel" }));
    fireEvent.click(within(modal).getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ enabledModels: ["my-model"] }),
      ),
    );
    await within(modal).findByText("ai.providerUpdated");
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "ai.modelPicker" }).textContent,
      ).toContain("my-model"),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getByText("ai.autoModeCompact")).toBeTruthy();
    fireEvent.change(composer, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalled());
    expect(JSON.parse(api.fetch.mock.calls[0][1].body)).toMatchObject({
      model: "my-model",
      approvalMode: "auto",
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    expect(screen.getByText("ai.autoModeCompact")).toBeTruthy();
    await waitFor(() =>
      expect(api.saveAiPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "my-model",
          approvalMode: "auto",
        }),
      ),
    );
  });
  it("never sends channel model configuration through chat preference writes", async () => {
    render(<AiPanel />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    await waitFor(() => expect(api.saveAiPreferences).toHaveBeenCalled());
    for (const [body] of api.saveAiPreferences.mock.calls) {
      expect(body).not.toHaveProperty("providerEfforts");
      expect(body).not.toHaveProperty("providerModels");
    }
  });
  it("restores channel, model, thinking and approval after reload", async () => {
    api.getAiPreferences.mockResolvedValue({
      providerId: 1,
      model: "remember-me",
      approvalMode: "auto",
      reasoningEffort: "high",
      providerEfforts: { "1": "low" },
    });
    render(<AiPanel />);
    await ready();
    expect(screen.getByText("ai.autoModeCompact")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "ai.modelPicker" }).textContent,
    ).toContain("remember-me");
    expect(
      screen.getByRole("combobox", { name: "ai.reasoningEffort" }).textContent,
    ).toContain("ai.reasoning.high");
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    expect(screen.getByText("ai.autoModeCompact")).toBeTruthy();
  });
  it("lets the outer chat switch among saved models", async () => {
    api.getAiProviders.mockResolvedValue([
      {
        id: 1,
        providerType: "openai",
        label: "Upstream",
        defaultModel: "auto-model",
        enabledModels: ["auto-model"],
        enabled: true,
      },
    ]);
    api.getAiProviderModels.mockResolvedValue([
      "auto-model",
      "other-model",
      "third-model",
    ]);
    render(<AiPanel />);
    await screen.findByPlaceholderText("ai.inputPlaceholder");
    fireEvent.click(screen.getByRole("button", { name: "ai.chatSettings" }));
    const settings = screen.getByRole("dialog", { name: "ai.chatSettings" });
    fireEvent.click(
      await within(settings).findByRole("checkbox", { name: "other-model" }),
    );
    fireEvent.click(
      within(settings).getByRole("checkbox", { name: "third-model" }),
    );
    fireEvent.click(within(settings).getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(1, {
        enabledModels: ["auto-model", "other-model", "third-model"],
      }),
    );
    await within(settings).findByText("ai.providerUpdated");
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    const composerPicker = screen.getByRole("combobox", {
      name: "ai.modelPicker",
    });
    fireEvent.keyDown(composerPicker, { key: "ArrowDown" });
    const option = await screen.findByRole("option", {
      name: /third-model/,
    });
    fireEvent.click(option);
    await waitFor(() =>
      expect(api.saveAiPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 1,
          model: "third-model",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    expect(
      screen.getByRole("combobox", { name: "ai.modelPicker" }).textContent,
    ).toContain("third-model");
  });
  it("remembers shared terminal execution across a new conversation", async () => {
    render(<AiPanel hostId={1} getTerminalSessionId={() => "terminal-1"} />);
    const composer = await ready();
    fireEvent.click(screen.getByRole("button", { name: "ai.chatSettings" }));
    const mode = screen.getByRole("combobox", {
      name: "ai.executionMode",
    });
    fireEvent.keyDown(mode, { key: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("option", { name: "ai.executionShared" }),
    );
    await waitFor(() =>
      expect(api.saveAiPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ executionMode: "shared" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.chatSettings" }));
    expect(
      screen.getByRole("combobox", { name: "ai.executionMode" }).textContent,
    ).toContain("ai.executionShared");
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    fireEvent.change(composer, { target: { value: "Use this terminal" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(api.fetch.mock.calls[0][1].body)).toMatchObject({
      executionMode: "shared",
      terminalSessionId: "terminal-1",
    });
  });

  it("restores the active host conversation after the panel is closed and reopened", async () => {
    const saved = {
      conversation: {
        id: 7,
        title: "Ongoing chat",
        providerId: 1,
        model: "auto-model",
        hostId: 1,
        contextState: null,
      },
      messages: [
        {
          id: 4,
          conversationId: 7,
          role: "user",
          content: "Earlier question",
          toolCalls: null,
        },
        {
          id: 5,
          conversationId: 7,
          role: "assistant",
          content: "Earlier answer",
          toolCalls: null,
        },
      ],
      proposals: [],
    };
    api.getAiConversation.mockResolvedValue(saved);
    const first = render(
      <AiPanel hostId={1} getTerminalSessionId={() => "terminal-1"} />,
    );
    const firstComposer = await ready();
    fireEvent.change(firstComposer, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() =>
      expect(api.saveActiveAiConversation).toHaveBeenCalledWith(1, 7),
    );
    first.unmount();

    api.getAiPreferences.mockResolvedValue({
      providerId: 1,
      model: "auto-model",
      approvalMode: "review",
      reasoningEffort: "auto",
      executionMode: "shared",
      activeConversations: { "1": 7 },
      providerEfforts: {},
      providerModels: {},
    });
    render(<AiPanel hostId={1} getTerminalSessionId={() => "terminal-1"} />);
    const composer = await ready();
    await waitFor(() => expect(api.getAiConversation).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Earlier answer")).toBeTruthy();
    fireEvent.change(composer, {
      target: { value: "Continue our discussion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.send" }));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(api.fetch.mock.calls[1][1].body)).toMatchObject({
      conversationId: 7,
      executionMode: "shared",
      hostId: 1,
    });

    await waitFor(() =>
      expect(api.saveActiveAiConversation).toHaveBeenCalledWith(1, 7),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "ai.newConversation" }),
      ).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.newConversation" }));
    await waitFor(() =>
      expect(api.saveActiveAiConversation).toHaveBeenCalledWith(1, null),
    );
    expect(screen.queryByText("Earlier answer")).toBeNull();
  });

  it("does not restore another host's conversation in this terminal", async () => {
    api.getAiPreferences.mockResolvedValue({
      providerId: 1,
      model: "auto-model",
      approvalMode: "review",
      reasoningEffort: "auto",
      executionMode: "shared",
      activeConversations: { "1": 7 },
      providerEfforts: {},
      providerModels: {},
    });
    render(<AiPanel hostId={2} getTerminalSessionId={() => "terminal-2"} />);
    await ready();
    expect(api.getAiConversation).not.toHaveBeenCalled();
    expect(api.saveActiveAiConversation).not.toHaveBeenCalled();
  });
});

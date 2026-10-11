import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AiProvider } from "../../src/frontend/ai-api";
const api = vi.hoisted(() => ({ getAiProviderModels: vi.fn() }));
vi.mock("../../src/frontend/ai-api", () => api);
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { AiComposerControls } from "../../src/frontend/AiComposerControls";
// Radix scrolls the focused menu item. jsdom does not implement layout scrolling.
const originalScroll = Object.getOwnPropertyDescriptor(
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
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows multiple enabled models per channel, including same-named models, without discovery", async () => {
  const base: AiProvider = {
    id: 1,
    providerType: "openai",
    label: "A",
    baseUrl: null,
    apiKeyPrefix: "test",
    defaultModel: "same",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    enabledModels: ["same", "a-only"],
  };
  const choose = vi.fn();
  render(
    <AiComposerControls
      providers={[
        base,
        { ...base, id: 2, label: "B", enabledModels: ["same", "b-only"] },
      ]}
      providerId={1}
      model="same"
      reasoningEffort="auto"
      disabled={false}
      onChooseModel={choose}
      onReasoningChange={() => {}}
    />,
  );
  fireEvent.keyDown(screen.getByRole("combobox", { name: "ai.modelPicker" }), {
    key: "ArrowDown",
  });
  await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
  const option = screen
    .getAllByRole("option")
    .find((row) => row.textContent?.includes("b-only"));
  expect(option).toBeTruthy();
  fireEvent.click(option!);
  expect(choose).toHaveBeenCalledWith(2, "b-only");
  expect(api.getAiProviderModels).not.toHaveBeenCalled();
});

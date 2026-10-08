import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  AiSessionControls,
  type ApprovalMode,
} from "../../src/frontend/AiSessionControls";
import type { AiProvider } from "../../src/frontend/ai-api";

const api = vi.hoisted(() => ({ getAiProviderModels: vi.fn() }));
vi.mock("../../src/frontend/ai-api", () => api);
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
const provider: AiProvider = {
  id: 1,
  providerType: "ollama",
  label: "Local",
  baseUrl: null,
  apiKeyPrefix: null,
  defaultModel: "default-model",
  enabled: true,
  createdAt: "",
};
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<ApprovalMode>("review");
  return (
    <AiSessionControls
      providers={[provider]}
      providerId={1}
      onProviderChange={() => {}}
      model={model}
      onModelChange={setModel}
      approvalMode={mode}
      onApprovalModeChange={setMode}
      disabled={disabled}
    />
  );
}
beforeEach(() => {
  api.getAiProviderModels.mockReset().mockResolvedValue(["other-model"]);
});
afterEach(cleanup);
async function discoveryFinished() {
  await waitFor(() =>
    expect(
      document.querySelector('option[value="other-model"]'),
    ).not.toBeNull(),
  );
}
describe("shared conversation controls", () => {
  it("starts in approval mode and requires explicit confirmation for auto execution", async () => {
    render(<Harness />);
    await discoveryFinished();
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "ai.autoModeWarning",
    );
    expect(screen.queryByText("ai.autoModeActive")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ai.enableAutoMode" }));
    expect(
      screen
        .getByRole("button", { name: "ai.autoMode" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ai.autoMode" }));
    expect(
      screen
        .getByRole("button", { name: "ai.reviewMode" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("accepts a custom model when discovery fails", async () => {
    api.getAiProviderModels.mockRejectedValue(new Error("unavailable"));
    render(<Harness />);
    await screen.findByText("ai.modelDiscoveryFallback");
    const input = screen.getByLabelText("ai.modelPicker") as HTMLInputElement;
    expect(input.value).toBe("default-model");
    fireEvent.change(input, { target: { value: "custom-model" } });
    expect(input.value).toBe("custom-model");
  });
  it("never overwrites a typed model when a slow model list arrives", async () => {
    let finish: (models: string[]) => void = () => {};
    api.getAiProviderModels.mockReturnValue(
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
    );
    render(<Harness />);
    const input = screen.getByLabelText("ai.modelPicker") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my-model" } });
    finish(["other-model"]);
    await discoveryFinished();
    expect(input.value).toBe("my-model");
  });
  it("locks model and mode controls while a run is active", async () => {
    render(<Harness disabled />);
    await discoveryFinished();
    expect(
      (screen.getByLabelText("ai.modelPicker") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "ai.reviewMode",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

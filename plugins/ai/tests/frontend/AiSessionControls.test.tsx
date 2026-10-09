import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiSessionControls, type ApprovalMode } from "../../src/frontend/AiSessionControls";
import type { AiProvider } from "../../src/frontend/ai-api";

const api = vi.hoisted(() => ({ getAiProviderModels: vi.fn() }));
vi.mock("../../src/frontend/ai-api", () => api);
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
const provider: AiProvider = {
  id: 1, providerType: "ollama", label: "Local", baseUrl: null, apiKeyPrefix: null,
  defaultModel: "default-model", enabled: true, createdAt: "",
};
function Harness({ disabled = false, defaultModel = provider.defaultModel }: {
  disabled?: boolean; defaultModel?: string | null;
}) {
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<ApprovalMode>("review");
  return (
    <AiSessionControls
      providers={[{ ...provider, defaultModel }]}
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

describe("model discovery and execution mode", () => {
  it("starts in review and requires explicit confirmation before auto mode", async () => {
    render(<Harness />);
    await waitFor(() => expect(api.getAiProviderModels).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    expect(screen.getByRole("alert").textContent).toContain("ai.autoModeWarning");
    fireEvent.click(screen.getByRole("button", { name: "ai.enableAutoMode" }));
    expect(screen.getByRole("button", { name: "ai.autoMode" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ai.autoMode" }));
    expect(screen.getByRole("button", { name: "ai.reviewMode" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("automatically selects the upstream model when there is no configured default", async () => {
    render(<Harness defaultModel={null} />);
    await screen.findByText("other-model");
    expect(screen.getByLabelText("ai.modelPicker").textContent).toContain("other-model");
  });

  it("exposes a manual model ID when the upstream discovery fails", async () => {
    api.getAiProviderModels.mockRejectedValue(new Error("unavailable"));
    render(<Harness defaultModel={null} />);
    await screen.findByText("ai.modelDiscoveryFallback");
    const input = screen.getByLabelText("ai.modelPicker") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom-model" } });
    expect(input.value).toBe("custom-model");
  });

  it("can explicitly refresh the upstream model list", async () => {
    render(<Harness />);
    await waitFor(() => expect(api.getAiProviderModels).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByLabelText("ai.modelRefresh") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("ai.modelRefresh"));
    await waitFor(() => expect(api.getAiProviderModels).toHaveBeenCalledTimes(2));
  });

  it("locks model and mode controls during execution", async () => {
    render(<Harness disabled />);
    await waitFor(() => expect(api.getAiProviderModels).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("ai.modelPicker").getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("button", { name: "ai.reviewMode" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

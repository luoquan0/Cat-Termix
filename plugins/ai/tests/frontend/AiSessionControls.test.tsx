import { ApprovalToggle } from "../../src/frontend/ApprovalToggle";
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

const api = vi.hoisted(() => ({
  getAiProviderModels: vi.fn(),
  updateAiProvider: vi.fn(),
}));
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

function Harness({
  disabled = false,
  defaultModel = "default-model",
  enabledModels = null,
}: {
  disabled?: boolean;
  defaultModel?: string | null;
  enabledModels?: string[] | null;
}) {
  const [providers, setProviders] = useState<AiProvider[]>([
    { ...provider, defaultModel, enabledModels },
  ]);
  const [model, setModel] = useState(defaultModel ?? "");
  const [mode, setMode] = useState<ApprovalMode>("review");
  return (
    <>
      <ApprovalToggle mode={mode} onChange={setMode} disabled={disabled} />
      <AiSessionControls
        providers={providers}
        providerId={1}
        onProviderChange={() => {}}
        model={model}
        onModelChange={setModel}
        onProviderUpdated={(updated) => setProviders([updated])}
        disabled={disabled}
      />
      <output data-testid="active-model">{model}</output>
    </>
  );
}

beforeEach(() => {
  api.getAiProviderModels
    .mockReset()
    .mockResolvedValue(["default-model", "other-model"]);
  api.updateAiProvider.mockReset().mockImplementation(
    async (_id: number, patch: { enabledModels: string[] }) => ({
      ...provider,
      enabledModels: patch.enabledModels,
      defaultModel: patch.enabledModels.includes("default-model")
        ? "default-model"
        : (patch.enabledModels[0] ?? null),
    }),
  );
});
afterEach(cleanup);

describe("multi-model chat settings", () => {
  it("shows checkboxes instead of the old single-model picker", async () => {
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "other-model" });
    expect(
      screen.queryByRole("combobox", { name: "ai.modelPicker" }),
    ).toBeNull();
    expect(screen.getByRole("combobox", { name: "ai.selectProvider" }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "ai.save" }))
      .toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "ai.reviewMode" }));
    expect(screen.getByRole("button", { name: "ai.autoModeCompact" }))
      .toHaveProperty("disabled", false);
  });

  it("saves several models without switching the current model", async () => {
    render(<Harness enabledModels={["default-model"]} />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "other-model" }),
    );
    expect(screen.getByTestId("active-model").textContent).toBe(
      "default-model",
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(1, {
        enabledModels: ["default-model", "other-model"],
      }),
    );
    expect(await screen.findByText("ai.providerUpdated")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "other-model" }))
      .toHaveProperty("checked", true);
    expect(screen.getByTestId("active-model").textContent).toBe("default-model");
  });

  it("falls back when the active model is disabled", async () => {
    render(<Harness enabledModels={["default-model", "other-model"]} />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "default-model" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(screen.getByTestId("active-model").textContent).toBe(
        "other-model",
      ),
    );
    expect(api.updateAiProvider).toHaveBeenCalledWith(1, {
      enabledModels: ["other-model"],
    });
  });

  it("clearing the list also clears the active model", async () => {
    render(<Harness enabledModels={["default-model"]} />);
    fireEvent.click(screen.getByRole("button", { name: "ai.clearModels" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(1, {
        enabledModels: [],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-model").textContent).toBe(""),
    );
  });

  it("keeps custom IDs available when model discovery fails", async () => {
    api.getAiProviderModels.mockRejectedValue(new Error("offline"));
    render(<Harness enabledModels={["default-model"]} />);
    expect(await screen.findByText("ai.modelDiscoveryFallback")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", {
      name: "ai.addCustomModelId",
    }), { target: { value: "private-model" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.addModel" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(1, {
        enabledModels: ["default-model", "private-model"],
      }),
    );
  });

  it("refreshes discovery without losing saved models", async () => {
    render(<Harness enabledModels={["default-model", "private-model"]} />);
    await waitFor(() =>
      expect(api.getAiProviderModels).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.modelRefresh" }));
    await waitFor(() =>
      expect(api.getAiProviderModels).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("checkbox", { name: "private-model" }))
      .toHaveProperty("checked", true);
  });

  it("does not discard the pending model list when a save fails", async () => {
    api.updateAiProvider.mockRejectedValueOnce(new Error("403 Forbidden"));
    render(<Harness enabledModels={["default-model"]} />);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "other-model" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "403 Forbidden",
    );
    expect(screen.getByRole("checkbox", { name: "other-model" }))
      .toHaveProperty("checked", true);
    expect(screen.getByRole("button", { name: "ai.save" }))
      .toHaveProperty("disabled", false);
  });

  it("locks channel editing during an active run", async () => {
    render(<Harness disabled enabledModels={["default-model"]} />);
    await screen.findByRole("checkbox", { name: "default-model" });
    expect(
      screen.getByRole("combobox", { name: "ai.selectProvider" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("checkbox", { name: "default-model" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "ai.save" }),
    ).toHaveProperty("disabled", true);
  });
});

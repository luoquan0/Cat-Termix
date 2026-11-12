import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AiProvider } from "../../src/frontend/ai-api";

const api = vi.hoisted(() => ({
  createAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(),
  getAiProviderModels: vi.fn(),
  probeAiModels: vi.fn(),
  updateAiProvider: vi.fn(),
}));

vi.mock("../../src/frontend/ai-api", () => api);
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AiProviderSettings } from "../../src/frontend/AiProviderSettings";

const provider: AiProvider = {
  id: 7,
  providerType: "ollama",
  label: "Local Ollama",
  baseUrl: "http://localhost:11434",
  apiKeyPrefix: null,
  defaultModel: "llama3.1",
  enabled: true,
  createdAt: "2026-08-21T00:00:00Z",
};

beforeEach(() => {
  api.getAiProviderModels.mockReset();
  api.getAiProviderModels.mockResolvedValue([]);
  api.updateAiProvider.mockReset();
  api.updateAiProvider.mockResolvedValue(provider);
});

afterEach(cleanup);

describe("AiProviderSettings", () => {
  it("edits an existing provider name and configured model", async () => {
    const onChanged = vi.fn();
    render(<AiProviderSettings providers={[provider]} onChanged={onChanged} />);

    expect(screen.getByText(/llama3\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    const label = screen.getByLabelText("ai.providerLabel");
    const model = screen.getByLabelText("ai.defaultModel");
    fireEvent.change(label, { target: { value: "Production Ollama" } });
    fireEvent.change(model, { target: { value: "qwen3:32b" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));

    await waitFor(() => {
      expect(api.updateAiProvider).toHaveBeenCalledWith(7, {
        label: "Production Ollama",
        defaultModel: "qwen3:32b",
        enabledModels: ["qwen3:32b"],
        defaultReasoningEffort: "auto",
      });
    });
    expect(onChanged).toHaveBeenCalledWith(7);
  });

  it("loads the saved provider model list when editing starts", async () => {
    api.getAiProviderModels.mockResolvedValue(["llama3.1", "qwen3:32b"]);
    render(<AiProviderSettings providers={[provider]} onChanged={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    await waitFor(() => {
      expect(api.getAiProviderModels).toHaveBeenCalledWith(7);
    });
    expect(
      screen.getByRole("combobox", { name: "ai.defaultModel" }),
    ).toBeTruthy();
  });

  it("shows the provider error when refreshing models fails", async () => {
    api.getAiProviderModels.mockRejectedValue(
      new Error("Add llm.internal to the AI endpoint allowlist"),
    );
    render(<AiProviderSettings providers={[provider]} onChanged={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    expect(
      await screen.findByText("Add llm.internal to the AI endpoint allowlist"),
    ).toBeTruthy();
  });
});

describe("enabled channel model editor", () => {
  it("preserves multiple selected models when discovery is unavailable", async () => {
    api.getAiProviderModels.mockRejectedValue(new Error("offline"));
    const onChanged = vi.fn();
    render(
      <AiProviderSettings
        providers={[
          { ...provider, enabledModels: ["llama3.1", "private-model"] },
        ]}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));
    expect(
      await screen.findByRole("checkbox", { name: "private-model" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          enabledModels: ["llama3.1", "private-model"],
        }),
      ),
    );
  });

  it("saves several models and removes an unchecked default instead of re-enabling it", async () => {
    api.getAiProviderModels.mockResolvedValue([
      "llama3.1",
      "qwen3:32b",
      "model-c",
    ]);
    render(
      <AiProviderSettings
        providers={[{ ...provider, enabledModels: ["llama3.1"] }]}
        onChanged={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "qwen3:32b" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "model-c" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "llama3.1" }));
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(api.updateAiProvider).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          enabledModels: ["qwen3:32b", "model-c"],
          defaultModel: "qwen3:32b",
        }),
      ),
    );
  });
});

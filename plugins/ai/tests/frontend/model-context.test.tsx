import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useModelContext } from "../../src/frontend/use-model-context";
import { ContextControls } from "../../src/frontend/ContextControls";
import { DEFAULT_CONTEXT_POLICY } from "../../src/shared/context-policy";
import type { AiModelContext } from "../../src/frontend/ai-api";

const mock = vi.hoisted(() => ({
  getAiModelContext: vi.fn(),
  saveAiModelContextOverride: vi.fn(),
}));
vi.mock("../../src/frontend/ai-api", () => mock);
vi.mock("react-i18next", async (original) => ({
  ...(await original<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => {
  mock.getAiModelContext
    .mockReset()
    .mockImplementation(async (_id: number, model: string) => ({
      providerId: 1,
      model,
      contextWindow: model === "model-a" ? 128000 : 256000,
      detectedWindow: model === "model-a" ? 128000 : 256000,
      source: "upstream",
      detectedSource: "upstream",
      manualOverride: null,
      maxOutputTokens: null,
      referenceUrl: null,
      detail: null,
    }));
  mock.saveAiModelContextOverride.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

function ModelHarness() {
  const [model, setModel] = useState("model-a");
  const [capacity, setCapacity] = useState(32768);
  const { info, loading } = useModelContext(1, model, setCapacity);
  return (
    <div>
      <button onClick={() => setModel("model-b")}>Switch model</button>
      <span data-testid="capacity">{capacity}</span>
      <span data-testid="source">
        {info?.source ?? (loading ? "loading" : "none")}
      </span>
    </div>
  );
}
describe("selected model context", () => {
  it("automatically selects the active model's capacity and resets on switch", async () => {
    render(<ModelHarness />);
    await waitFor(() =>
      expect(screen.getByTestId("capacity").textContent).toBe("128000"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch model" }));
    await waitFor(() =>
      expect(screen.getByTestId("capacity").textContent).toBe("256000"),
    );
    expect(mock.getAiModelContext).toHaveBeenCalledWith(1, "model-b");
    expect(screen.getByTestId("source").textContent).toBe("upstream");
  });

  it("persists changes only for the chosen model and can clear an override", async () => {
    const detected: AiModelContext = {
      providerId: 1,
      model: "model-a",
      contextWindow: 128000,
      detectedWindow: null,
      source: "manual",
      detectedSource: "unknown",
      manualOverride: 128000,
      maxOutputTokens: null,
      referenceUrl: null,
      detail: null,
    };
    function SettingsHarness() {
      const [policy, setPolicy] = useState({
        ...DEFAULT_CONTEXT_POLICY,
        contextWindow: 128000,
      });
      return (
        <ContextControls
          value={policy}
          onChange={setPolicy}
          modelInfo={detected}
          modelSelected
          modelLoading={false}
          modelError={null}
          disabled={false}
          onRefresh={() => {}}
          onOverride={async (window) => {
            await mock.saveAiModelContextOverride(1, "model-a", window);
          }}
        />
      );
    }
    render(<SettingsHarness />);
    const input = screen.getByLabelText(
      "ai.contextCapacity",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "256000" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mock.saveAiModelContextOverride).toHaveBeenCalledWith(
        1,
        "model-a",
        256000,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ai.contextResetAutomatic" }),
    );
    await waitFor(() =>
      expect(mock.saveAiModelContextOverride).toHaveBeenCalledWith(
        1,
        "model-a",
        null,
      ),
    );
  });
});

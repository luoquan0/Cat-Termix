import { describe, expect, it } from "vitest";
import {
  parseEnabledModels,
  providerModelOptions,
} from "../../src/shared/model-selection";
import { normalizeAiPreferences } from "../../src/shared/reasoning";

describe("channel model selection", () => {
  it("normalizes model IDs without guessing model names or channels", () => {
    expect(parseEnabledModels([" model-a ", "model-b", "model-a"])).toEqual([
      "model-a",
      "model-b",
    ]);
    for (const input of [
      null,
      "model-a",
      [""],
      ["bad\nmodel"],
      [42],
      Array(101).fill("a"),
    ]) {
      expect(() => parseEnabledModels(input)).toThrow();
    }
  });
  it("uses only enabled models, even offline or with a disabled current model", () => {
    expect(
      providerModelOptions(
        { defaultModel: "old", enabledModels: ["a", "b"] },
        ["unexpected"],
        "old",
      ),
    ).toEqual(["a", "b"]);
    expect(
      providerModelOptions(
        { defaultModel: "old", enabledModels: [] },
        ["a"],
        "old",
      ),
    ).toEqual([]);
    expect(
      providerModelOptions({ defaultModel: "old" }, ["a", "old"], "custom"),
    ).toEqual(["old", "a", "custom"]);
  });
  it("keeps same-named models independent per channel and corrupt restrictions closed", () => {
    expect(
      normalizeAiPreferences({
        providerModels: { "1": ["same", "a"], "2": ["same", "b"], "3": "bad" },
      }).providerModels,
    ).toEqual({ "1": ["same", "a"], "2": ["same", "b"], "3": [] });
  });
});

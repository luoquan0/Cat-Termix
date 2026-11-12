/** Model IDs remain provider-scoped; never infer a channel from a model name. */
export const MAX_ENABLED_MODELS = 100;
export function parseEnabledModels(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > MAX_ENABLED_MODELS ||
    input.some(
      (model) =>
        typeof model !== "string" ||
        !model.trim() ||
        model.length > 200 ||
        /[\x00-\x1f\x7f]/.test(model),
    )
  )
    throw new Error("Select up to 100 valid model IDs (1-200 characters each)");
  return [...new Set((input as string[]).map((model) => model.trim()))];
}

export function providerModelOptions(
  provider: { enabledModels?: string[] | null; defaultModel: string | null },
  discovered: string[] = [],
  current = "",
): string[] {
  // An explicit empty selection means no models, NOT all upstream models.
  if (Array.isArray(provider.enabledModels)) return [...provider.enabledModels];
  return [
    ...new Set(
      [provider.defaultModel ?? "", ...discovered, current].filter(Boolean),
    ),
  ];
}

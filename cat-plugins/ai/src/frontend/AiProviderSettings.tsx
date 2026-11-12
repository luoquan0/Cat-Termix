import { AiEnabledModels } from "./AiEnabledModels";
import {
  parseEnabledModels,
  providerModelOptions,
} from "../shared/model-selection";
import { getErrorMessage } from "./errors";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@termix/plugin-sdk/ui";
import {
  createAiProvider,
  deleteAiProvider,
  getAiProviderModels,
  probeAiModels,
  updateAiProvider,
  type AiProvider,
  type AiProviderType,
  type ReasoningEffort,
} from "./ai-api";
import { REASONING_EFFORTS } from "../shared/reasoning";

const PROVIDER_TYPES: Array<{
  value: AiProviderType;
  labelKey: string;
  needsBaseUrl: boolean;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
}> = [
  {
    value: "ollama",
    labelKey: "ai.providerOllama",
    needsBaseUrl: true,
    needsApiKey: false,
    defaultBaseUrl: "http://localhost:11434",
  },
  {
    value: "anthropic",
    labelKey: "ai.providerAnthropic",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "openai",
    labelKey: "ai.providerOpenai",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "gemini",
    labelKey: "ai.providerGemini",
    needsBaseUrl: false,
    needsApiKey: true,
  },
  {
    value: "openai_compatible",
    labelKey: "ai.providerOpenaiCompatible",
    needsBaseUrl: true,
    needsApiKey: false,
  },
];

interface AiProviderSettingsProps {
  providers: AiProvider[];
  /** selectId names a provider that should become the active one. */
  onChanged: (selectId?: number) => void;
  onAdded?: () => void;
}

function AiProviderEditForm({
  provider,
  onSaved,
  onCancel,
}: {
  provider: AiProvider;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(provider.label);
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? "");
  const [enabledModels, setEnabledModels] = useState<string[] | null>(
    provider.enabledModels ?? null,
  );
  const [defaultReasoningEffort, setDefaultReasoningEffort] =
    useState<ReasoningEffort>(provider.defaultReasoningEffort ?? "auto");
  const [models, setModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectWarning, setDetectWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const detectModels = useCallback(async () => {
    setDetecting(true);
    setDetectWarning(null);
    try {
      const detected = await getAiProviderModels(provider.id);
      setModels(detected);
      setCustomModel(!!defaultModel && !detected.includes(defaultModel));
    } catch (error) {
      setModels([]);
      setCustomModel(true);
      setDetectWarning(getErrorMessage(error, t("ai.modelDetectFailed")));
    } finally {
      setDetecting(false);
    }
  }, [provider.id, defaultModel, t]);

  useEffect(() => {
    void detectModels();
    // The initial model value belongs to this provider. Subsequent edits must
    // not trigger a provider model-list request on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  async function handleSave() {
    if (!label.trim()) {
      toast.error(t("ai.labelRequired"));
      return;
    }

    setSaving(true);
    try {
      await updateAiProvider(provider.id, {
        label: label.trim(),
        defaultModel: defaultModel.trim() || null,
        defaultReasoningEffort,
        enabledModels: parseEnabledModels([
          ...new Set([
            ...providerModelOptions(
              { enabledModels, defaultModel: null },
              models,
            ),
            ...(defaultModel.trim() ? [defaultModel.trim()] : []),
          ]),
        ]),
      });
      toast.success(t("ai.providerUpdated"));
      onSaved();
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.providerSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-none border border-border p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`ai-provider-label-${provider.id}`}>
          {t("ai.providerLabel")}
        </Label>
        <Input
          id={`ai-provider-label-${provider.id}`}
          className="rounded-none"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`ai-provider-model-${provider.id}`}
            className="min-w-0 flex-1"
          >
            {t("ai.defaultModel")}
          </Label>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => void detectModels()}
            disabled={detecting}
          >
            {detecting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            {t("ai.modelRefresh")}
          </button>
        </div>

        {models.length > 0 && !customModel ? (
          <Select
            value={defaultModel || undefined}
            onValueChange={(value) => {
              if (value === "__custom__") {
                setCustomModel(true);
                setDefaultModel("");
                return;
              }
              setDefaultModel(value);
              setEnabledModels((current) =>
                current === null ? null : [...new Set([...current, value])],
              );
            }}
          >
            <SelectTrigger
              id={`ai-provider-model-${provider.id}`}
              className="rounded-none"
            >
              <SelectValue placeholder={t("ai.modelPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="z-[300]">
              {models.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">{t("ai.modelCustom")}</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            id={`ai-provider-model-${provider.id}`}
            className="rounded-none"
            value={defaultModel}
            onChange={(event) => setDefaultModel(event.target.value)}
            placeholder={t("ai.defaultModelPlaceholder")}
          />
        )}
        {detectWarning && (
          <p className="text-[11px] leading-snug text-destructive">
            {detectWarning}
          </p>
        )}
      </div>

      <AiEnabledModels
        models={models}
        selected={providerModelOptions({ enabledModels, defaultModel }, models)}
        disabled={saving}
        onChange={(selection) => {
          setEnabledModels(selection);
          if (!selection.includes(defaultModel))
            setDefaultModel(selection[0] ?? "");
        }}
      />

      <div className="space-y-1.5">
        <Label htmlFor={`ai-provider-thinking-${provider.id}`}>
          {t("ai.defaultReasoningEffort")}
        </Label>
        <Select
          value={defaultReasoningEffort}
          onValueChange={(value) =>
            setDefaultReasoningEffort(value as ReasoningEffort)
          }
        >
          <SelectTrigger id={`ai-provider-thinking-${provider.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[300]">
            {REASONING_EFFORTS.map((effort) => (
              <SelectItem key={effort} value={effort}>
                {t(`ai.reasoning.${effort}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {t("ai.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          {t("ai.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function AiProviderSettings({
  providers,
  onChanged,
  onAdded,
}: AiProviderSettingsProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [providerType, setProviderType] = useState<AiProviderType>("ollama");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [enabledModels, setEnabledModels] = useState<string[] | null>(null);
  const [defaultReasoningEffort, setDefaultReasoningEffort] =
    useState<ReasoningEffort>("auto");

  const [models, setModels] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectWarning, setDetectWarning] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);

  const spec = PROVIDER_TYPES.find((entry) => entry.value === providerType)!;

  useEffect(() => {
    setBaseUrl(spec.defaultBaseUrl ?? "");
    setApiKey("");
    setModels([]);
    setEnabledModels(null);
    setDefaultModel("");
    setDefaultReasoningEffort("auto");
    setCustomModel(false);
    setDetectWarning(null);
  }, [providerType, spec.defaultBaseUrl]);

  /**
   * Fetches the provider's own model list so nobody has to go and look model
   * names up. Falls back to a curated list when the endpoint is unreachable,
   * and a free-text field is always available for anything not listed.
   */
  const detectModels = useCallback(async () => {
    setDetecting(true);
    setDetectWarning(null);
    try {
      const result = await probeAiModels({
        providerType,
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
      });
      setModels(result.models);
      if (result.source !== "live") {
        setDetectWarning(result.warning || t("ai.modelDetectFailed"));
      }
      // Pick the first suggestion so the field is never left empty.
      setDefaultModel((current) => current || result.models[0] || "");
    } catch {
      setDetectWarning(t("ai.modelDetectFailed"));
    } finally {
      setDetecting(false);
    }
  }, [providerType, baseUrl, apiKey, t]);

  // Detect as soon as the provider has enough detail to be reachable.
  useEffect(() => {
    if (!adding) return;
    const ready = spec.needsApiKey ? apiKey.trim().length > 0 : true;
    if (!ready) return;
    const timer = setTimeout(() => void detectModels(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, providerType, baseUrl, apiKey]);

  async function handleAdd() {
    if (!label.trim()) {
      toast.error(t("ai.labelRequired"));
      return;
    }
    setSaving(true);
    try {
      const created = await createAiProvider({
        providerType,
        label: label.trim(),
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
        defaultModel: defaultModel.trim() || null,
        defaultReasoningEffort,
        enabledModels: parseEnabledModels([
          ...new Set([
            ...(enabledModels ?? []),
            ...(defaultModel.trim() ? [defaultModel.trim()] : []),
          ]),
        ]),
      });
      setAdding(false);
      setLabel("");
      setApiKey("");
      setDefaultModel("");
      setEnabledModels(null);
      setDefaultReasoningEffort("auto");
      onChanged(created.id);
      onAdded?.();
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.providerSaveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAiProvider(id);
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, t("ai.providerDeleteFailed")));
    }
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) =>
        editingId === provider.id ? (
          <AiProviderEditForm
            key={provider.id}
            provider={provider}
            onSaved={() => {
              setEditingId(null);
              onChanged(provider.id);
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={provider.id}
            className="flex items-center justify-between gap-2 rounded-none border border-border bg-muted px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {provider.label}
              </div>
              <div className="flex gap-3 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                <span className="shrink-0">{provider.providerType}</span>
                {Array.isArray(provider.enabledModels) && (
                  <span className="shrink-0">
                    {t("ai.enabledModelsCount", {
                      count: provider.enabledModels.length,
                    })}
                  </span>
                )}
                {provider.defaultModel && (
                  <span className="truncate">{provider.defaultModel}</span>
                )}
                <span className="truncate">
                  {t(
                    `ai.reasoning.${provider.defaultReasoningEffort ?? "auto"}`,
                  )}
                </span>
                {provider.baseUrl && (
                  <span className="truncate">{provider.baseUrl}</span>
                )}
                {provider.apiKeyPrefix && (
                  <span className="shrink-0">{provider.apiKeyPrefix}…</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setEditingId(provider.id);
                }}
                aria-label={t("ai.editProvider")}
              >
                <Pencil size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(provider.id)}
                aria-label={t("ai.removeProvider")}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ),
      )}

      {!adding && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
        >
          <Plus size={14} />
          {t("ai.addProvider")}
        </Button>
      )}

      {adding && (
        <div className="space-y-3 rounded-none border border-border p-3">
          <div className="space-y-1.5">
            <Label>{t("ai.providerType")}</Label>
            <Select
              value={providerType}
              onValueChange={(value) =>
                setProviderType(value as AiProviderType)
              }
            >
              <SelectTrigger className="rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                {PROVIDER_TYPES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {t(entry.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("ai.providerLabel")}</Label>
            <Input
              className="rounded-none"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("ai.providerLabelPlaceholder")}
            />
          </div>

          {spec.needsBaseUrl && (
            <div className="space-y-1.5">
              <Label>{t("ai.baseUrl")}</Label>
              <Input
                className="rounded-none"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://localhost:11434"
              />
              <p className="text-xs text-muted-foreground">
                {t("ai.privateEndpointHint")}
              </p>
            </div>
          )}

          {(spec.needsApiKey || providerType === "openai_compatible") && (
            <div className="space-y-1.5">
              <Label>{t("ai.apiKey")}</Label>
              <Input
                className="rounded-none"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label className="min-w-0 flex-1">{t("ai.defaultModel")}</Label>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => void detectModels()}
                disabled={detecting}
              >
                {detecting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                {t("ai.modelRefresh")}
              </button>
            </div>

            {models.length > 0 && !customModel ? (
              <Select
                value={defaultModel || undefined}
                onValueChange={(value) => {
                  if (value === "__custom__") {
                    setCustomModel(true);
                    setDefaultModel("");
                    return;
                  }
                  setDefaultModel(value);
                  setEnabledModels((current) => [
                    ...new Set([...(current ?? []), value]),
                  ]);
                }}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue placeholder={t("ai.modelPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="z-[300]">
                  {models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                  {/* Anything the provider did not list is still reachable. */}
                  <SelectItem value="__custom__">
                    {t("ai.modelCustom")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="rounded-none"
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                placeholder={t("ai.defaultModelPlaceholder")}
              />
            )}

            {detectWarning && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {detectWarning}
              </p>
            )}
          </div>

          <AiEnabledModels
            models={models}
            selected={enabledModels ?? (defaultModel ? [defaultModel] : [])}
            disabled={saving}
            onChange={(selection) => {
              setEnabledModels(selection);
              if (!selection.includes(defaultModel))
                setDefaultModel(selection[0] ?? "");
            }}
          />

          <div className="space-y-1.5">
            <Label>{t("ai.defaultReasoningEffort")}</Label>
            <Select
              value={defaultReasoningEffort}
              onValueChange={(value) =>
                setDefaultReasoningEffort(value as ReasoningEffort)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                {REASONING_EFFORTS.map((effort) => (
                  <SelectItem key={effort} value={effort}>
                    {t(`ai.reasoning.${effort}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={handleAdd}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t("ai.save")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setAdding(false)}
            >
              {t("ai.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { parseEnabledModels } from "../shared/model-selection";

/** Selection survives discovery failures; custom IDs do not need a /models endpoint. */
export function AiEnabledModels({
  models,
  selected,
  onChange,
  disabled,
}: {
  models: string[];
  selected: string[];
  onChange: (models: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const choices = [...new Set([...models, ...selected])];
  function change(next: string[]) {
    try {
      onChange(parseEnabledModels(next));
      setError("");
    } catch {
      setError(t("ai.enabledModelsInvalid"));
    }
  }
  return (
    <fieldset
      className="space-y-2 rounded-md border border-border p-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">
        {t("ai.enabledModels")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("ai.enabledModelsHint")}
      </p>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={t("ai.searchModels")}
        placeholder={t("ai.searchModels")}
      />
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {choices
          .filter((model) => model.toLowerCase().includes(search.toLowerCase()))
          .map((model) => (
            <label
              key={model}
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <input
                type="checkbox"
                checked={selected.includes(model)}
                onChange={(event) =>
                  change(
                    event.target.checked
                      ? [...selected, model]
                      : selected.filter((id) => id !== model),
                  )
                }
              />
              <span className="break-all">{model}</span>
            </label>
          ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={disabled}
          onClick={() => change(choices)}
        >
          {t("ai.enableAllModels")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={disabled}
          onClick={() => change([])}
        >
          {t("ai.clearModels")}
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          {t("ai.enabledModelsCount", { count: selected.length })}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          value={custom}
          maxLength={200}
          onChange={(event) => setCustom(event.target.value)}
          aria-label={t("ai.addCustomModelId")}
          placeholder={t("ai.addCustomModelId")}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !custom.trim()}
          onClick={() => {
            change([...selected, custom.trim()]);
            setCustom("");
          }}
        >
          {t("ai.addModel")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

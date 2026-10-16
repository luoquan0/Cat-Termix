import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { PaintbrushIcon } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { BrandingSettings } from "@/api/settings-api";
import { AccordionSection } from "./AdminSettingsShared";
import {
  BRANDING_LOGO_ACCEPT,
  BRANDING_WALLPAPER_ACCEPT,
  isAcceptedBrandingLogoFile,
  isAcceptedBrandingWallpaperFile,
} from "./branding-logo-file";

export function AdminBrandingSection({
  open,
  onToggle,
  settings,
  setSettings,
  saving,
  onSave,
  onResetLogo,
  onResetWallpaper,
}: {
  open: boolean;
  onToggle: () => void;
  settings: BrandingSettings | null;
  setSettings: (settings: BrandingSettings) => void;
  saving: boolean;
  onSave: () => void;
  onResetLogo: () => void;
  onResetWallpaper: () => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !settings) return;
    if (!isAcceptedBrandingLogoFile(file)) {
      alert(t("admin.brandingLogoInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSettings({ ...settings, logo: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  function handleWallpaperChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !settings) return;
    if (!isAcceptedBrandingWallpaperFile(file)) {
      alert(t("admin.brandingWallpaperInvalid"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSettings({ ...settings, wallpaper: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <AccordionSection
      label={t("admin.sectionBranding")}
      icon={<PaintbrushIcon className="size-3.5" />}
      open={open}
      onToggle={onToggle}
    >
      {settings === null ? (
        <div className="pt-3 text-xs text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : (
        <div className="@container flex flex-col gap-0 pt-2">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 py-3 @md:grid-cols-2 border-b border-border">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.brandingAppName")}
              </span>
              <Input
                aria-label={t("admin.brandingAppName")}
                value={settings.appName}
                onChange={(event) =>
                  setSettings({ ...settings, appName: event.target.value })
                }
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.brandingAppNameDesc")}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">
                {t("admin.brandingTagline")}
              </span>
              <Input
                aria-label={t("admin.brandingTagline")}
                value={settings.tagline}
                onChange={(event) =>
                  setSettings({ ...settings, tagline: event.target.value })
                }
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">
                {t("admin.brandingTaglineDesc")}
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 py-3 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("admin.brandingLogo")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("admin.brandingLogoDesc")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {settings.logo ? (
                <img
                  src={settings.logo}
                  alt=""
                  className="size-10 object-contain border border-border bg-muted/40"
                />
              ) : (
                <div className="size-10 border border-dashed border-border" />
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={BRANDING_LOGO_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("admin.brandingLogoUpload")}
              </Button>
              {settings.logo && (
                <Button size="sm" variant="outline" onClick={onResetLogo}>
                  {t("admin.brandingLogoReset")}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 py-3 border-b border-border">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("admin.brandingWallpaper")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("admin.brandingWallpaperDesc")}
              </span>
            </div>
            {settings.wallpaper && (
              <img
                src={settings.wallpaper}
                alt={t("admin.brandingWallpaper")}
                className="w-full max-w-sm h-28 object-cover border border-border"
              />
            )}
            <div className="flex items-center gap-3">
              <input
                ref={wallpaperInputRef}
                type="file"
                accept={BRANDING_WALLPAPER_ACCEPT}
                className="hidden"
                onChange={handleWallpaperChange}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => wallpaperInputRef.current?.click()}
              >
                {t("admin.brandingWallpaperUpload")}
              </Button>
              {settings.wallpaper && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onResetWallpaper}
                  disabled={saving}
                >
                  {t("admin.brandingWallpaperReset")}
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-3">
            <Button
              size="sm"
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </AccordionSection>
  );
}

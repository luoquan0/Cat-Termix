import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@termix/plugin-sdk/ui";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 3;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_SUBMISSION_BYTES = 4 * 1024 * 1024;

export const AI_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export function isAiImageFile(file: Pick<File, "type" | "size">): boolean {
  return (
    ACCEPTED_TYPES.has(file.type) &&
    file.size > 0 &&
    file.size <= MAX_SOURCE_BYTES
  );
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the image"));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Larger photos are compressed before they cross the network. The backend
 * independently validates and normalizes every image; client conversion is
 * only for performance and to permit ordinary phone photos.
 */
export async function prepareAiImage(file: File): Promise<string> {
  if (!isAiImageFile(file)) throw new Error("Invalid image format or size");
  if (file.size <= MAX_SUBMISSION_BYTES) return readDataUrl(file);

  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot resize the image; use a smaller file");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / bitmap.width, 2048 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.78),
    );
    if (
      !compressed ||
      !ACCEPTED_TYPES.has(compressed.type) ||
      compressed.size > MAX_SUBMISSION_BYTES
    ) {
      throw new Error("Image is too large after compression");
    }
    return readDataUrl(compressed);
  } finally {
    bitmap.close();
  }
}

/** Screen capture requires user permission; clipboard paste works on HTTP too. */
export async function captureAiScreenshot(): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture unavailable: paste a screenshot instead");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  const video = document.createElement("video");
  try {
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not open the captured screen"));
    });
    await video.play();
    const scale = Math.min(1, 2048 / video.videoWidth, 2048 / video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not capture the screen");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.78),
    );
    if (
      !image ||
      !ACCEPTED_TYPES.has(image.type) ||
      image.size > MAX_SUBMISSION_BYTES
    ) {
      throw new Error("Screenshot is too large; paste or crop it first");
    }
    return readDataUrl(image);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

export function AiImageComposer({
  images,
  setImages,
  textareaRef,
  disabled,
  t,
}: {
  images: string[];
  setImages: Dispatch<SetStateAction<string[]>>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  t: (key: string) => string;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const appendImages = useCallback(
    async (files: File[]) => {
      if (disabled || busyRef.current || files.length === 0) return;
      if (images.length + files.length > MAX_IMAGES) {
        toast.error(t("ai.imageLimit"));
        return;
      }
      if (files.some((file) => !isAiImageFile(file))) {
        toast.error(t("ai.imageInvalid"));
        return;
      }

      busyRef.current = true;
      setBusy(true);
      try {
        const additions = await Promise.all(files.map(prepareAiImage));
        setImages((previous) =>
          previous.length + additions.length <= MAX_IMAGES
            ? [...previous, ...additions]
            : previous,
        );
      } catch {
        toast.error(t("ai.imageInvalid"));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [disabled, images.length, setImages, t],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (
        disabled ||
        document.activeElement !== textareaRef.current ||
        !event.clipboardData
      ) return;
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (!files.length) return;
      event.preventDefault();
      void appendImages(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [appendImages, disabled, textareaRef]);

  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-2">
          {images.map((image, index) => (
            <div key={index} className="relative">
              <img
                src={image}
                alt={`${t("ai.attachedImage")} ${index + 1}`}
                className="size-20 rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                disabled={disabled}
                aria-label={`${t("ai.removeImage")} ${index + 1}`}
                onClick={() =>
                  setImages((previous) =>
                    previous.filter((_, position) => position !== index),
                  )
                }
                className="absolute -right-1 -top-1 rounded-full border border-border bg-background p-0.5 text-foreground"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          ref={pickerRef}
          type="file"
          accept={AI_IMAGE_ACCEPT}
          multiple
          className="hidden"
          aria-label={t("ai.addImages")}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void appendImages(files);
          }}
        />
        <Button
          size="sm"
          type="button"
          variant="ghost"
          title={t("ai.addImages")}
          aria-label={t("ai.addImages")}
          disabled={disabled || busy || images.length >= MAX_IMAGES}
          onClick={() => pickerRef.current?.click()}
        >
          <ImagePlus size={16} />
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          title={t("ai.captureScreenshot")}
          aria-label={t("ai.captureScreenshot")}
          disabled={disabled || busy || images.length >= MAX_IMAGES}
          onClick={() => {
            if (busyRef.current) return;
            busyRef.current = true;
            setBusy(true);
            void captureAiScreenshot()
              .then((image) => {
                setImages((previous) =>
                  previous.length < MAX_IMAGES ? [...previous, image] : previous,
                );
              })
              .catch(() => {
                toast.error(t("ai.screenshotPasteHint"));
                textareaRef.current?.focus();
              })
              .finally(() => {
                busyRef.current = false;
                setBusy(false);
              });
          }}
        >
          <Camera size={16} />
        </Button>
      </div>
    </>
  );
}

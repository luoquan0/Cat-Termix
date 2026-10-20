import sharp from "sharp";

/**
 * A chat image is submitted as a data URL, then verified and re-encoded on
 * the server before storage or forwarding to a model. Never trust its MIME
 * prefix or allow SVG/remote image URLs to reach a provider.
 */
export const CHAT_IMAGE_MAX_COUNT = 3;
export const CHAT_IMAGE_MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const CHAT_IMAGE_MAX_STORED_BYTES = 1024 * 1024;
const MAX_PIXELS = 20_000_000;

export async function normalizeChatImages(value: unknown): Promise<string[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > CHAT_IMAGE_MAX_COUNT) {
    throw new Error(`Attach no more than ${CHAT_IMAGE_MAX_COUNT} images`);
  }

  const images: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("Invalid image attachment");
    }
    const match = item.match(
      /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match || Math.ceil(match[2].length * 0.75) > CHAT_IMAGE_MAX_INPUT_BYTES + 2) {
      throw new Error("Invalid image or image exceeds 4 MB");
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > CHAT_IMAGE_MAX_INPUT_BYTES) {
      throw new Error("Image exceeds 4 MB");
    }
    try {
      const source = sharp(buffer, { failOn: "error", limitInputPixels: MAX_PIXELS });
      const meta = await source.metadata();
      if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) {
        throw new Error("Unsupported image format");
      }
      const normalized = await source
        .rotate()
        .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      if (normalized.length > CHAT_IMAGE_MAX_STORED_BYTES) {
        throw new Error("Image is too detailed after compression; choose a smaller image");
      }
      images.push(`data:image/webp;base64,${normalized.toString("base64")}`);
    } catch (error) {
      throw new Error(
        error instanceof Error &&
          error.message.startsWith("Image is too detailed")
          ? error.message
          : "Image must be a valid PNG, JPEG or WEBP",
      );
    }
  }
  return images;
}

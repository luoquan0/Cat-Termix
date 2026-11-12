import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CHAT_IMAGE_MAX_INPUT_BYTES,
  normalizeChatImages,
} from "../../src/backend/chat-images.js";

const url = (bytes: Buffer, mime = "image/png") =>
  `data:${mime};base64,${bytes.toString("base64")}`;

describe("AI chat image validation", () => {
  it("accepts a screenshot and normalizes it to bounded WEBP", async () => {
    const source = await sharp({
      create: {
        width: 2100,
        height: 1200,
        channels: 3,
        background: "#234567",
      },
    })
      .png()
      .toBuffer();
    const images = await normalizeChatImages([url(source)]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(/^data:image\/webp;base64,/);
    const result = await sharp(
      Buffer.from(images[0].split(",")[1], "base64"),
    ).metadata();
    expect(result.format).toBe("webp");
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
  });

  it("accepts JPEG and WEBP but rejects disguised files and SVG", async () => {
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const webp = await sharp(jpeg).webp().toBuffer();
    expect(
      await normalizeChatImages([
        url(jpeg, "image/jpeg"),
        url(webp, "image/webp"),
      ]),
    ).toHaveLength(2);
    await expect(
      normalizeChatImages([url(Buffer.from("not a picture"))]),
    ).rejects.toThrow(/valid PNG/);
    await expect(
      normalizeChatImages([url(Buffer.from("<svg/>"), "image/svg+xml")]),
    ).rejects.toThrow(/Invalid image/);
  });

  it("rejects oversized and excessive attachments before persistence", async () => {
    await expect(normalizeChatImages(["not a data url"])).rejects.toThrow();
    await expect(normalizeChatImages({ images: [] })).rejects.toThrow();
    await expect(normalizeChatImages([null])).rejects.toThrow();
    await expect(
      normalizeChatImages(new Array(4).fill("image")),
    ).rejects.toThrow(/no more than 3/);
    await expect(
      normalizeChatImages([url(Buffer.alloc(CHAT_IMAGE_MAX_INPUT_BYTES + 1))]),
    ).rejects.toThrow(/exceeds 4 MB/);
    expect(await normalizeChatImages(undefined)).toEqual([]);
  });
});

-- Images are base64 WEBP blobs and can exceed MySQL TEXT's 64 KiB ceiling.
ALTER TABLE `p_ai_messages` ADD COLUMN `images` LONGTEXT;

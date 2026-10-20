-- Persist normalized user image attachments without altering existing text.
ALTER TABLE "p_ai_messages" ADD COLUMN "images" text;

CREATE TABLE IF NOT EXISTS "p_ai_chat_preferences" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "user_id" text NOT NULL,
  "value" text NOT NULL,
  "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_chat_preferences_user" ON "p_ai_chat_preferences" ("user_id");

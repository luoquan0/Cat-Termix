CREATE TABLE IF NOT EXISTS "p_ai_model_contexts" (
  "id" integer PRIMARY KEY AUTOINCREMENT,
  "user_id" text NOT NULL,
  "provider_id" integer NOT NULL,
  "model" text NOT NULL,
  "context_window" integer NOT NULL,
  "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("provider_id") REFERENCES "p_ai_providers" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_model_context_unique" ON "p_ai_model_contexts" ("user_id", "provider_id", "model");

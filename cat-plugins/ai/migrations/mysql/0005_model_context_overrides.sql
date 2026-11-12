CREATE TABLE IF NOT EXISTS `p_ai_model_contexts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` varchar(255) NOT NULL,
  `provider_id` int NOT NULL,
  `model` varchar(255) NOT NULL,
  `context_window` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`provider_id`) REFERENCES `p_ai_providers` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `idx_ai_model_context_unique` (`user_id`, `provider_id`, `model`)
);

CREATE TABLE IF NOT EXISTS `p_ai_chat_preferences` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `user_id` varchar(255) NOT NULL,
  `value` text NOT NULL,
  `updated_at` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `idx_ai_chat_preferences_user` (`user_id`)
);

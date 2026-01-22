CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('user','global') NOT NULL,
  user_id INT NULL,
  type VARCHAR(50) NOT NULL,
  message VARCHAR(255) NOT NULL,
  trade_id INT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_scope (scope),
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_trade (trade_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_trade FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trade_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trade_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trade_messages_trade (trade_id),
  INDEX idx_trade_messages_sender (sender_id),
  CONSTRAINT fk_trade_messages_trade FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trade_meeting_proposals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trade_id INT NOT NULL,
  proposer_id INT NOT NULL,
  proposed_at DATETIME NOT NULL,
  status ENUM('proposed','accepted','declined','cancelled') NOT NULL DEFAULT 'proposed',
  responded_by INT NULL,
  responded_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_meeting_trade (trade_id),
  INDEX idx_meeting_proposer (proposer_id),
  INDEX idx_meeting_status (status),
  CONSTRAINT fk_meeting_trade FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_proposer FOREIGN KEY (proposer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_meeting_responder FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

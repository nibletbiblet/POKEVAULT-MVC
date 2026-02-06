CREATE TABLE IF NOT EXISTS admin_activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id INT NULL,
  details TEXT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_activity_admin_id (admin_id),
  INDEX idx_admin_activity_action (action),
  INDEX idx_admin_activity_entity (entity_type, entity_id),
  CONSTRAINT fk_admin_activity_admin
    FOREIGN KEY (admin_id) REFERENCES users(id)
);

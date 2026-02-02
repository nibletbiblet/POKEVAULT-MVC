CREATE TABLE IF NOT EXISTS trades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  initiator_id INT NOT NULL,
  initiator_product_id INT NOT NULL,
  responder_id INT NULL,
  responder_product_id INT NULL,
  status ENUM('open','pending_initiator','accepted','declined','cancelled') DEFAULT 'open',
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trades_initiator FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_initiator_product FOREIGN KEY (initiator_product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_responder FOREIGN KEY (responder_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_trades_responder_product FOREIGN KEY (responder_product_id) REFERENCES products(id) ON DELETE SET NULL
);

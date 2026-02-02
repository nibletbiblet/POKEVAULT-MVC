CREATE TABLE transactions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  orderId INT NOT NULL,
  paymentMethod VARCHAR(50) NOT NULL,
  paymentStatus VARCHAR(50) NOT NULL,
  paymentReference VARCHAR(255) DEFAULT NULL,
  amount DECIMAL(10,2) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_transactions_order (orderId),
  CONSTRAINT fk_transactions_order FOREIGN KEY (orderId)
    REFERENCES orders (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

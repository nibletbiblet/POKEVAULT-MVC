CREATE TABLE wallets (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  balance DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_user_wallet (user_id),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE wallet_transactions (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  type ENUM('TOP_UP','BONUS','PAYMENT','REFUND') COLLATE utf8mb4_general_ci NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reference VARCHAR(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wallet_tx_user (user_id),
  CONSTRAINT fk_wallet_tx_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE pokevault_coins (
  user_id INT NOT NULL,
  balance DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_pokevault_coins_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE bnpl_installments (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  installment_no INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('PENDING','PAID','CANCELLED') COLLATE utf8mb4_general_ci DEFAULT 'PENDING',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY order_id (order_id),
  CONSTRAINT bnpl_installments_ibfk_1 FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE bnpl_refund_requests (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  reason TEXT COLLATE utf8mb4_general_ci NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED') COLLATE utf8mb4_general_ci DEFAULT 'PENDING',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_order_refund (order_id),
  KEY user_id (user_id),
  CONSTRAINT bnpl_refund_requests_ibfk_1 FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT bnpl_refund_requests_ibfk_2 FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE bnpl_cards (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  cardholder_name VARCHAR(100) COLLATE utf8mb4_general_ci NOT NULL,
  last4 CHAR(4) COLLATE utf8mb4_general_ci NOT NULL,
  expiry VARCHAR(7) COLLATE utf8mb4_general_ci NOT NULL,
  billing_address VARCHAR(255) COLLATE utf8mb4_general_ci NOT NULL,
  status VARCHAR(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_id (user_id),
  CONSTRAINT fk_bnpl_cards_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE refund_requests (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  reason VARCHAR(50) COLLATE utf8mb4_general_ci NOT NULL,
  description TEXT COLLATE utf8mb4_general_ci,
  status VARCHAR(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY fk_refund_requests_order (order_id),
  KEY fk_refund_requests_user (user_id),
  CONSTRAINT fk_refund_requests_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_refund_requests_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

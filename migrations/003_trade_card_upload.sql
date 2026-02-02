ALTER TABLE trades
  MODIFY COLUMN initiator_product_id INT NULL;

ALTER TABLE trades
  ADD COLUMN initiator_card_name VARCHAR(255) NULL AFTER initiator_product_id;

ALTER TABLE trades
  ADD COLUMN initiator_card_image VARCHAR(255) NULL AFTER initiator_card_name;

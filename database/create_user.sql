-- Run once as root: mysql -u root -p < database/create_user.sql
CREATE DATABASE IF NOT EXISTS smart_shop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'shop_app'@'localhost' IDENTIFIED BY 'shop_pass';
CREATE USER IF NOT EXISTS 'shop_app'@'%' IDENTIFIED BY 'shop_pass';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_shop.* TO 'shop_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_shop.* TO 'shop_app'@'%';
FLUSH PRIVILEGES;

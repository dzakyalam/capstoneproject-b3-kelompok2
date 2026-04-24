CREATE DATABASE IF NOT EXISTS cimb_guardian CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cimb_guardian;

CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id VARCHAR(30) NOT NULL UNIQUE,
    message_text TEXT NOT NULL,
    extracted_urls TEXT NULL,
    extracted_phones TEXT NULL,
    url_flag TINYINT(1) NOT NULL DEFAULT 0,
    phone_flag TINYINT(1) NOT NULL DEFAULT 0,
    nlp_prob DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
    ai_extra_score DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    risk_score INT NOT NULL DEFAULT 0,
    risk_level VARCHAR(30) NOT NULL DEFAULT 'Low Risk',
    admin_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    admin_note TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_reports_ticket (ticket_id),
    INDEX idx_reports_status (admin_status),
    INDEX idx_reports_created (created_at)
);

CREATE TABLE IF NOT EXISTS whitelist_domains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    domain VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whitelist_phones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(30) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO whitelist_domains (domain) VALUES
('cimbniaga.co.id'),
('www.cimbniaga.co.id'),
('octoclicks.co.id'),
('www.octoclicks.co.id'),
('cimbclicks.co.id')
ON DUPLICATE KEY UPDATE domain = VALUES(domain);

INSERT INTO whitelist_phones (phone) VALUES
('14041'),
('1500800'),
('+622114041'),
('+62211500800'),
('+62811880055')
ON DUPLICATE KEY UPDATE phone = VALUES(phone);

INSERT INTO admins (username, password_hash, role) VALUES
('admin', SHA2('admin123', 256), 'admin')
ON DUPLICATE KEY UPDATE username = VALUES(username);

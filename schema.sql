-- 1. USERS Table
CREATE TABLE users (
    id VARCHAR2(36) PRIMARY KEY,
    email VARCHAR2(255) NOT NULL UNIQUE,
    password_hash VARCHAR2(255) NOT NULL,
    kyc_status VARCHAR2(20) DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'VERIFIED', 'FAILED')),
    kyc_job_id VARCHAR2(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. CAMPAIGNS Table
CREATE TABLE campaigns (
    id VARCHAR2(50) PRIMARY KEY,
    creator_id VARCHAR2(36) NOT NULL,
    title VARCHAR2(150) NOT NULL,
    description VARCHAR2(1000),
    target_amount NUMBER(12, 2) NOT NULL CHECK (target_amount > 0),
    raised_amount NUMBER(12, 2) DEFAULT 0.00 NOT NULL CHECK (raised_amount >= 0),
    status VARCHAR2(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_campaigns_user FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. TRANSACTIONS Table
CREATE TABLE transactions (
    transaction_id VARCHAR2(50) PRIMARY KEY,
    campaign_id VARCHAR2(50) NOT NULL,
    funder_id VARCHAR2(36) NOT NULL,
    amount NUMBER(12, 2) NOT NULL CHECK (amount > 0),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_tx_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    CONSTRAINT fk_tx_funder FOREIGN KEY (funder_id) REFERENCES users(id)
);

CREATE INDEX idx_campaigns_creator ON campaigns(creator_id);
CREATE INDEX idx_tx_campaign ON transactions(campaign_id);
CREATE INDEX idx_tx_funder ON transactions(funder_id);
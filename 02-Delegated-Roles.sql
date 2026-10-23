-- ASK KIN - 02_delegated_roles.sql
-- SAFE MIGRATION: Only adds new tables, never alters existing ones
-- Run this in Oracle SQL Developer / sqlplus after 01_base_schema.sql

-- 1. DELEGATES TABLE (Owner / Delegate / Viewer)
CREATE TABLE delegates (
    id VARCHAR2(36) PRIMARY KEY,
    name VARCHAR2(150) NOT NULL,
    email VARCHAR2(255) NOT NULL UNIQUE,
    phone VARCHAR2(20),
    role VARCHAR2(20) DEFAULT 'viewer' CHECK (role IN ('owner','delegate','viewer')),
    is_active NUMBER(1) DEFAULT 1 CHECK (is_active IN (0,1)),
    expires_at TIMESTAMP NULL -- NULL = permanent until owner revokes
    created_by VARCHAR2(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_delegates_email ON delegates(email);
CREATE INDEX idx_delegates_role ON delegates(role);

-- Seed Owner (Ralph) - expires far future
INSERT INTO delegates (id, name, email, phone, role, is_active, expires_at, created_by)
VALUES (SYS_GUID(), 'Ralph Owner', 'askkin.client@gmail.com', NULL, 'owner', 1, TIMESTAMP '2030-12-31 23:59:59', 'system');

-- 2. AUDIT LOGS - Every delegate action logged (non-deletable)
CREATE TABLE audit_logs (
    id VARCHAR2(36) PRIMARY KEY,
    delegate_id VARCHAR2(36) NOT NULL,
    delegate_email VARCHAR2(255),
    action VARCHAR2(100) NOT NULL, -- KYC_APPROVE, CAMPAIGN_PAUSE, SUPPORT_REPLY etc
    target_type VARCHAR2(50), -- kyc, campaign, donation, support
    target_id VARCHAR2(100),
    details VARCHAR2(1000),
    ip_address VARCHAR2(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_audit_delegate FOREIGN KEY (delegate_id) REFERENCES delegates(id) ON DELETE CASCADE
);

CREATE INDEX idx_audit_delegate ON audit_logs(delegate_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- 3. KYC_REQUESTS TABLE (if you don't have it yet - safe to create)
-- If you already have kyc in users table, this is a view helper table
CREATE TABLE kyc_requests (
    id VARCHAR2(36) PRIMARY KEY,
    user_id VARCHAR2(36) NOT NULL,
    id_type VARCHAR2(50), -- NATIONAL_ID, PASSPORT
    id_number VARCHAR2(100),
    document_url VARCHAR2(500),
    status VARCHAR2(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','FAILED','REJECTED')),
    reviewed_by VARCHAR2(36),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. SUPPORT_LOGS TABLE (for delegate donor issues)
CREATE TABLE support_logs (
    id VARCHAR2(36) PRIMARY KEY,
    channel VARCHAR2(20) CHECK (channel IN ('CALL','WHATSAPP','EMAIL')),
    campaign_id VARCHAR2(50),
    donor_email VARCHAR2(255),
    message VARCHAR2(1000),
    handled_by VARCHAR2(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Add STATUS=PAUSED to campaigns if not already (for delegate pause)
-- This will fail if already exists, ignore error
-- ALTER TABLE campaigns ADD CONSTRAINT chk_status_paused CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED','PAUSED'));

COMMIT;

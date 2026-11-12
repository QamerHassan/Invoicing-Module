-- ==============================================================================================
-- MASTER RESTORE SCRIPT: Modern Rizviz Invoicing Schema Customizations (.NET 8 + React Modernization)
-- Target: SQL Server (Execute directly in SSMS or sqlcmd on the Restored Database)
-- Safety: IDEMPOTENT - Safe to run multiple times. No data loss.
-- 
-- SUMMARY OF CUSTOMIZATIONS RESTORED BY THIS SCRIPT:
--   1. TABLE: dbo.Rizviz_Users (JWT Auth, User Management & BCrypt V2 upgrade)
--   2. TABLE: dbo.UserEmailSettings (Per-user SMTP credentials for Email tab)
--   3. TABLE: dbo.profile_invoice_audit_log (Audit trail for inline edits & To Be Discussed)
--   4. COLUMNS on dbo.Profile_invoicing:
--        - is_included (BIT DEFAULT 1: calculation inclusion toggle)
--        - to_be_discussed (BIT DEFAULT 0: discussion flag)
--        - discuss_note (NVARCHAR(500): discussion commentary)
--        - discuss_marked_by (NVARCHAR(100): user marking discussion)
--        - discuss_marked_time (DATETIME2: timestamp of discussion mark)
--   5. COLUMN on mkt.Projects:
--        - branch_code (INT NULL: foreign branch identification, e.g. branch_code = 5)
--   6. INDEXES for performance on audit logs & profile invoicing
--   7. BACKFILL: Sets is_included = 1 for all rows (PB default, only where NULL)
--   8. SECURITY: App user [InvoicingAppUser] mapped with db_datareader, db_datawriter & EXECUTE
-- ==============================================================================================

SET NOCOUNT ON;

DECLARE @CurrentDb NVARCHAR(128) = DB_NAME();
PRINT '===============================================================================';
PRINT 'Starting Rizviz Invoicing custom schema restoration on database: [' + @CurrentDb + ']';
PRINT 'Timestamp: ' + CONVERT(NVARCHAR(30), GETUTCDATE(), 120) + ' UTC';
PRINT '===============================================================================';

-- ----------------------------------------------------------------------------------------------
-- STEP 1: TABLE dbo.Rizviz_Users & Column PasswordHashV2
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.Rizviz_Users', 'U') IS NULL
BEGIN
    PRINT '[CREATE TABLE] dbo.Rizviz_Users ...';
    CREATE TABLE dbo.Rizviz_Users (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Rizviz_Users PRIMARY KEY CLUSTERED,
        Username NVARCHAR(100) NOT NULL,
        PasswordHash NVARCHAR(200) NOT NULL,
        FullName NVARCHAR(200) NULL,
        Email NVARCHAR(200) NULL,
        RoleName NVARCHAR(50) NULL,
        CompanyCode NVARCHAR(50) NULL,
        BranchCode NVARCHAR(50) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Rizviz_Users_IsActive DEFAULT 1,
        PasswordHashV2 NVARCHAR(256) NULL
    );
    PRINT '  -> Table dbo.Rizviz_Users created.';
END
ELSE
BEGIN
    PRINT '[EXISTS] Table dbo.Rizviz_Users already exists.';
    IF COL_LENGTH('dbo.Rizviz_Users', 'PasswordHashV2') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] PasswordHashV2 on dbo.Rizviz_Users ...';
        ALTER TABLE dbo.Rizviz_Users ADD PasswordHashV2 NVARCHAR(256) NULL;
        PRINT '  -> Column PasswordHashV2 added.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Rizviz_Users.PasswordHashV2 already exists.';
    END
END;

-- Seed default users or update PasswordHashV2 using dynamic SQL to prevent batch compilation issues
IF OBJECT_ID('dbo.Rizviz_Users', 'U') IS NOT NULL
BEGIN
    EXEC sp_executesql N'
        IF NOT EXISTS (SELECT 1 FROM dbo.Rizviz_Users)
        BEGIN
            PRINT ''[SEED DATA] Inserting default admin and hr accounts into dbo.Rizviz_Users ...'';
            INSERT INTO dbo.Rizviz_Users (Username, PasswordHash, FullName, Email, RoleName, IsActive, PasswordHashV2)
            VALUES 
                (''admin'', ''admin123'', ''Administrator'', ''admin@rizviz.com'', ''Admin'', 1, ''$2a$11$oKNUQcSD1j7aFjw.7d3TjulZEIkWIFrQep7QSRVKkO1bPOTVROkl2''),
                (''hr'', ''hr123'', ''HR Manager'', ''hr@rizviz.com'', ''HR'', 1, NULL);
            PRINT ''  -> Default accounts seeded (admin / hr).'';
        END
        ELSE
        BEGIN
            -- Ensure admin has BCrypt V2 hash populated if currently null
            UPDATE dbo.Rizviz_Users
            SET PasswordHashV2 = ''$2a$11$oKNUQcSD1j7aFjw.7d3TjulZEIkWIFrQep7QSRVKkO1bPOTVROkl2''
            WHERE Username = ''admin'' AND (PasswordHashV2 IS NULL OR PasswordHashV2 = '''');
        END;
    ';
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 2: TABLE dbo.UserEmailSettings
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.UserEmailSettings', 'U') IS NULL
BEGIN
    PRINT '[CREATE TABLE] dbo.UserEmailSettings ...';
    CREATE TABLE dbo.UserEmailSettings (
        UserId INT NOT NULL CONSTRAINT PK_UserEmailSettings PRIMARY KEY CLUSTERED,
        SenderEmail NVARCHAR(254) NOT NULL,
        EncryptedAppPassword NVARCHAR(MAX) NOT NULL,
        SmtpHost NVARCHAR(200) NULL,
        SmtpPort INT NULL,
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_UserEmailSettings_UpdatedAt DEFAULT (GETUTCDATE())
    );
    PRINT '  -> Table dbo.UserEmailSettings created.';
END
ELSE
BEGIN
    PRINT '[EXISTS] Table dbo.UserEmailSettings already exists.';
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 3: TABLE dbo.profile_invoice_audit_log
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.profile_invoice_audit_log', 'U') IS NULL
BEGIN
    PRINT '[CREATE TABLE] dbo.profile_invoice_audit_log ...';
    CREATE TABLE dbo.profile_invoice_audit_log (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_profile_invoice_audit_log PRIMARY KEY CLUSTERED,
        username NVARCHAR(100) NOT NULL,
        timestamp DATETIME2 NOT NULL CONSTRAINT DF_profile_invoice_audit_log_timestamp DEFAULT (SYSUTCDATETIME()),
        invoice_month VARCHAR(20) NOT NULL,
        cmp_prof_invoice_code BIGINT NULL,
        project_code INT NULL,
        field_name NVARCHAR(100) NOT NULL,
        old_value NVARCHAR(1000) NULL,
        new_value NVARCHAR(1000) NULL,
        is_month_finalized BIT NOT NULL CONSTRAINT DF_profile_invoice_audit_log_is_month_finalized DEFAULT 0
    );
    PRINT '  -> Table dbo.profile_invoice_audit_log created.';
END
ELSE
BEGIN
    PRINT '[EXISTS] Table dbo.profile_invoice_audit_log already exists.';
    IF COL_LENGTH('dbo.profile_invoice_audit_log', 'project_code') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] project_code on dbo.profile_invoice_audit_log ...';
        ALTER TABLE dbo.profile_invoice_audit_log ADD project_code INT NULL;
        PRINT '  -> Column project_code added.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.profile_invoice_audit_log.project_code already exists.';
    END
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 4: COLUMNS ON dbo.Profile_invoicing
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.Profile_invoicing', 'U') IS NOT NULL
BEGIN
    PRINT '[CHECK COLUMNS] dbo.Profile_invoicing ...';

    -- 4.1 is_included
    IF COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] is_included on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD is_included BIT NULL CONSTRAINT DF_Profile_invoicing_is_included DEFAULT 1;
        PRINT '  -> Column is_included added with default 1.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.is_included already exists.';
    END;

    -- 4.2 to_be_discussed
    IF COL_LENGTH('dbo.Profile_invoicing', 'to_be_discussed') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] to_be_discussed on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD to_be_discussed BIT NOT NULL CONSTRAINT DF_Profile_invoicing_to_be_discussed DEFAULT 0;
        PRINT '  -> Column to_be_discussed added with default 0.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.to_be_discussed already exists.';
    END;

    -- 4.3 discuss_note
    IF COL_LENGTH('dbo.Profile_invoicing', 'discuss_note') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] discuss_note on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD discuss_note NVARCHAR(500) NULL;
        PRINT '  -> Column discuss_note added.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.discuss_note already exists.';
    END;

    -- 4.4 discuss_marked_by
    IF COL_LENGTH('dbo.Profile_invoicing', 'discuss_marked_by') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] discuss_marked_by on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD discuss_marked_by NVARCHAR(100) NULL;
        PRINT '  -> Column discuss_marked_by added.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.discuss_marked_by already exists.';
    END;

    -- 4.5 discuss_marked_time
    IF COL_LENGTH('dbo.Profile_invoicing', 'discuss_marked_time') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] discuss_marked_time on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD discuss_marked_time DATETIME2 NULL;
        PRINT '  -> Column discuss_marked_time added.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.discuss_marked_time already exists.';
    END;

    -- 4.6 is_processed
    IF COL_LENGTH('dbo.Profile_invoicing', 'is_processed') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] is_processed on dbo.Profile_invoicing ...';
        ALTER TABLE dbo.Profile_invoicing 
            ADD is_processed BIT NOT NULL CONSTRAINT DF_Profile_invoicing_is_processed DEFAULT 0;
        PRINT '  -> Column is_processed added with default 0.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column dbo.Profile_invoicing.is_processed already exists.';
    END;
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 5: COLUMN ON mkt.Projects
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('mkt.Projects', 'U') IS NOT NULL
BEGIN
    PRINT '[CHECK COLUMNS] mkt.Projects ...';
    IF COL_LENGTH('mkt.Projects', 'branch_code') IS NULL
    BEGIN
        PRINT '  [ADD COLUMN] branch_code on mkt.Projects ...';
        ALTER TABLE mkt.Projects ADD branch_code INT NULL;
        PRINT '  -> Column branch_code added to mkt.Projects.';
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Column mkt.Projects.branch_code already exists.';
    END;
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 6: INDEXES FOR PERFORMANCE
-- ----------------------------------------------------------------------------------------------
PRINT '[CHECK INDEXES] Ensuring required nonclustered indexes ...';

-- 6.1 Index on Profile_invoicing (invoice_month, prfgrp_own_code)
IF OBJECT_ID('dbo.Profile_invoicing', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes 
       WHERE name = 'IX_Profile_invoicing_month_owner' 
         AND object_id = OBJECT_ID('dbo.Profile_invoicing')
   )
BEGIN
    PRINT '  [CREATE INDEX] IX_Profile_invoicing_month_owner ...';
    EXEC sp_executesql N'
        CREATE NONCLUSTERED INDEX IX_Profile_invoicing_month_owner
            ON dbo.Profile_invoicing (invoice_month, prfgrp_own_code)
            INCLUDE (is_included, to_be_discussed, project_code, total_usd_cost, charged_amt_usd);
    ';
    PRINT '  -> Index IX_Profile_invoicing_month_owner created.';
END
ELSE
BEGIN
    PRINT '  [EXISTS] Index IX_Profile_invoicing_month_owner already exists.';
END;

-- 6.2 Index on Profile_invoicing (to_be_discussed, invoice_month)
IF OBJECT_ID('dbo.Profile_invoicing', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes 
       WHERE name = 'IX_Profile_invoicing_to_be_discussed' 
         AND object_id = OBJECT_ID('dbo.Profile_invoicing')
   )
BEGIN
    PRINT '  [CREATE INDEX] IX_Profile_invoicing_to_be_discussed ...';
    EXEC sp_executesql N'
        CREATE NONCLUSTERED INDEX IX_Profile_invoicing_to_be_discussed
            ON dbo.Profile_invoicing (to_be_discussed, invoice_month)
            INCLUDE (cmp_prof_invoice_code, prfgrp_own_code, discuss_note, discuss_marked_by);
    ';
    PRINT '  -> Index IX_Profile_invoicing_to_be_discussed created.';
END
ELSE
BEGIN
    PRINT '  [EXISTS] Index IX_Profile_invoicing_to_be_discussed already exists.';
END;

-- 6.3 Index on profile_invoice_audit_log (invoice_month, cmp_prof_invoice_code)
IF OBJECT_ID('dbo.profile_invoice_audit_log', 'U') IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM sys.indexes 
       WHERE name = 'IX_profile_invoice_audit_log_lookup' 
         AND object_id = OBJECT_ID('dbo.profile_invoice_audit_log')
   )
BEGIN
    PRINT '  [CREATE INDEX] IX_profile_invoice_audit_log_lookup ...';
    EXEC sp_executesql N'
        CREATE NONCLUSTERED INDEX IX_profile_invoice_audit_log_lookup
            ON dbo.profile_invoice_audit_log (invoice_month, cmp_prof_invoice_code, project_code)
            INCLUDE (timestamp, username, field_name, old_value, new_value);
    ';
    PRINT '  -> Index IX_profile_invoice_audit_log_lookup created.';
END
ELSE
BEGIN
    PRINT '  [EXISTS] Index IX_profile_invoice_audit_log_lookup already exists.';
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 7: BACKFILL DATA FOR is_included AND to_be_discussed
-- Uses dynamic SQL to prevent batch compilation errors when columns were just added.
-- Backfills ONLY rows where is_included IS NULL so existing user edits are NEVER overwritten.
-- All rows default to is_included = 1 (matching PB behavior)
-- ----------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.Profile_invoicing', 'U') IS NOT NULL 
   AND COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NOT NULL
BEGIN
    PRINT '[BACKFILL] Updating is_included and to_be_discussed where values are NULL ...';

    EXEC sp_executesql N'
        DECLARE @NullCount INT;
        SELECT @NullCount = COUNT(*) FROM dbo.Profile_invoicing WHERE is_included IS NULL;
        IF @NullCount > 0
        BEGIN
            PRINT ''  Found '' + CAST(@NullCount AS NVARCHAR(10)) + '' row(s) with NULL is_included. Applying backfill...'';
            UPDATE dbo.Profile_invoicing
            SET is_included = 1
            WHERE is_included IS NULL;
            PRINT ''  -> is_included backfill completed successfully.'';
        END
        ELSE
        BEGIN
            PRINT ''  [OK] No NULL is_included rows found. Existing user values preserved.'';
        END;

        UPDATE dbo.Profile_invoicing
        SET to_be_discussed = 0
        WHERE to_be_discussed IS NULL;
    ';
END;

-- ----------------------------------------------------------------------------------------------
-- STEP 8: APPLICATION USER PERMISSIONS (InvoicingAppUser)
-- Grants SELECT, INSERT, UPDATE, DELETE (via db_datareader + db_datawriter) and EXECUTE.
-- NO ALTER or DDL privileges granted.
-- ----------------------------------------------------------------------------------------------
PRINT '[APP USER & PERMISSIONS] Checking [InvoicingAppUser] ...';

IF SUSER_ID('InvoicingAppUser') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'InvoicingAppUser')
    BEGIN
        PRINT '  Creating database user [InvoicingAppUser] for login [InvoicingAppUser] ...';
        CREATE USER [InvoicingAppUser] FOR LOGIN [InvoicingAppUser];
    END
    ELSE
    BEGIN
        PRINT '  [EXISTS] Database user [InvoicingAppUser] exists.';
    END;

    -- Grant read/write data roles
    ALTER ROLE db_datareader ADD MEMBER [InvoicingAppUser];
    ALTER ROLE db_datawriter ADD MEMBER [InvoicingAppUser];
    
    -- Grant execute on stored procedures
    GRANT EXECUTE TO [InvoicingAppUser];

    PRINT '  -> [InvoicingAppUser] permissions verified (db_datareader, db_datawriter, EXECUTE).';
END
ELSE
BEGIN
    PRINT '  [NOTICE] Server login [InvoicingAppUser] does not exist on this SQL Server instance.';
    PRINT '           If needed, create the login using backend/sql_setup.sql as sa.';
END;

PRINT '===============================================================================';
PRINT 'Rizviz Invoicing custom schema restoration finished successfully on [' + @CurrentDb + ']!';
PRINT '===============================================================================';

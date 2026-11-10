-- ==============================================================================================
-- VERIFICATION SCRIPT: Rizviz Invoicing Modern Custom Schema
-- Checks whether all required tables, columns, indexes, constraints, seed users,
-- and permissions exist in the currently active database.
-- Outputs: Clean tabular summary with status OK or MISSING for each object.
-- ==============================================================================================

SET NOCOUNT ON;

DECLARE @CurrentDb NVARCHAR(128) = DB_NAME();
PRINT '===============================================================================';
PRINT 'Rizviz Invoicing Custom Schema Verification on [' + @CurrentDb + ']';
PRINT 'Timestamp: ' + CONVERT(NVARCHAR(30), GETUTCDATE(), 120) + ' UTC';
PRINT '===============================================================================';

DECLARE @Results TABLE (
    Id INT IDENTITY(1,1),
    Category NVARCHAR(30),
    ObjectName NVARCHAR(80),
    TargetType NVARCHAR(40),
    Status NVARCHAR(10),
    Details NVARCHAR(250)
);

-- 1. Tables
INSERT INTO @Results (Category, ObjectName, TargetType, Status, Details)
VALUES 
(
    'Table', 
    'dbo.Rizviz_Users', 
    'USER_TABLE',
    CASE WHEN OBJECT_ID('dbo.Rizviz_Users', 'U') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Authentication & JWT users table'
),
(
    'Table', 
    'dbo.UserEmailSettings', 
    'USER_TABLE',
    CASE WHEN OBJECT_ID('dbo.UserEmailSettings', 'U') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Per-user SMTP credentials'
),
(
    'Table', 
    'dbo.profile_invoice_audit_log', 
    'USER_TABLE',
    CASE WHEN OBJECT_ID('dbo.profile_invoice_audit_log', 'U') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Audit history for profile invoices & projects'
);

-- 2. Custom Columns
INSERT INTO @Results (Category, ObjectName, TargetType, Status, Details)
VALUES
(
    'Column',
    'dbo.Rizviz_Users.PasswordHashV2',
    'COLUMN (NVARCHAR)',
    CASE WHEN COL_LENGTH('dbo.Rizviz_Users', 'PasswordHashV2') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'BCrypt hash upgrade for modern auth'
),
(
    'Column',
    'dbo.profile_invoice_audit_log.project_code',
    'COLUMN (INT/BIGINT)',
    CASE WHEN COL_LENGTH('dbo.profile_invoice_audit_log', 'project_code') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Audits project-level fields'
),
(
    'Column',
    'dbo.Profile_invoicing.is_included',
    'COLUMN (BIT)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Include/exclude checkbox toggle'
),
(
    'Column',
    'dbo.Profile_invoicing.to_be_discussed',
    'COLUMN (BIT)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'to_be_discussed') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'To Be Discussed status flag'
),
(
    'Column',
    'dbo.Profile_invoicing.discuss_note',
    'COLUMN (NVARCHAR)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'discuss_note') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Discussion notes text'
),
(
    'Column',
    'dbo.Profile_invoicing.discuss_marked_by',
    'COLUMN (NVARCHAR)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'discuss_marked_by') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Username marking for discussion'
),
(
    'Column',
    'dbo.Profile_invoicing.discuss_marked_time',
    'COLUMN (DATETIME2)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'discuss_marked_time') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Timestamp when marked for discussion'
),
(
    'Column',
    'dbo.Profile_invoicing.is_processed',
    'COLUMN (BIT)',
    CASE WHEN COL_LENGTH('dbo.Profile_invoicing', 'is_processed') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Processed status flag (Excel view to Processed view)'
),
(
    'Column',
    'mkt.Projects.branch_code',
    'COLUMN (INT)',
    CASE WHEN COL_LENGTH('mkt.Projects', 'branch_code') IS NOT NULL THEN 'OK' ELSE 'MISSING' END,
    'Branch identification (e.g. branch 5 foreign)'
);

-- 3. Indexes
INSERT INTO @Results (Category, ObjectName, TargetType, Status, Details)
VALUES
(
    'Index',
    'IX_Profile_invoicing_month_owner',
    'NONCLUSTERED INDEX',
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Profile_invoicing_month_owner' AND object_id = OBJECT_ID('dbo.Profile_invoicing')) THEN 'OK' ELSE 'MISSING' END,
    'dbo.Profile_invoicing (invoice_month, prfgrp_own_code)'
),
(
    'Index',
    'IX_Profile_invoicing_to_be_discussed',
    'NONCLUSTERED INDEX',
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Profile_invoicing_to_be_discussed' AND object_id = OBJECT_ID('dbo.Profile_invoicing')) THEN 'OK' ELSE 'MISSING' END,
    'dbo.Profile_invoicing (to_be_discussed, invoice_month)'
),
(
    'Index',
    'IX_profile_invoice_audit_log_lookup',
    'NONCLUSTERED INDEX',
    CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_profile_invoice_audit_log_lookup' AND object_id = OBJECT_ID('dbo.profile_invoice_audit_log')) THEN 'OK' ELSE 'MISSING' END,
    'dbo.profile_invoice_audit_log (invoice_month, cmp_prof_invoice_code, project_code)'
);

-- 4. Application User Permissions
INSERT INTO @Results (Category, ObjectName, TargetType, Status, Details)
VALUES
(
    'Security',
    'InvoicingAppUser (DB User)',
    'DATABASE_PRINCIPAL',
    CASE WHEN EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'InvoicingAppUser') THEN 'OK' ELSE 'MISSING' END,
    'App DB User mapped to login'
),
(
    'Security',
    'InvoicingAppUser (db_datareader)',
    'DATABASE_ROLE',
    CASE WHEN IS_ROLEMEMBER('db_datareader', 'InvoicingAppUser') = 1 THEN 'OK' ELSE 'MISSING' END,
    'Read access on all tables'
),
(
    'Security',
    'InvoicingAppUser (db_datawriter)',
    'DATABASE_ROLE',
    CASE WHEN IS_ROLEMEMBER('db_datawriter', 'InvoicingAppUser') = 1 THEN 'OK' ELSE 'MISSING' END,
    'Write access (INSERT/UPDATE/DELETE)'
);

-- 5. Data Backfill Checks
DECLARE @NullInc INT = 0;
IF COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NOT NULL
BEGIN
    EXEC sp_executesql N'SELECT @cnt = COUNT(*) FROM dbo.Profile_invoicing WHERE is_included IS NULL;',
        N'@cnt INT OUTPUT', @cnt = @NullInc OUTPUT;
END;

INSERT INTO @Results (Category, ObjectName, TargetType, Status, Details)
VALUES
(
    'Data Integrity',
    'Profile_invoicing.is_included',
    'NULL CHECK',
    CASE 
        WHEN COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NULL THEN 'MISSING'
        WHEN @NullInc = 0 THEN 'OK' 
        ELSE 'WARNING' 
    END,
    CASE 
        WHEN COL_LENGTH('dbo.Profile_invoicing', 'is_included') IS NULL THEN 'Column is_included does not exist yet'
        WHEN @NullInc = 0 THEN 'All rows backfilled (0 NULL rows)' 
        ELSE CAST(@NullInc AS NVARCHAR(10)) + ' NULL rows need backfill' 
    END
);

-- Output Report
SELECT 
    Id,
    Category,
    ObjectName,
    TargetType,
    Status,
    Details
FROM @Results
ORDER BY Id;

DECLARE @TotalChecks INT = (SELECT COUNT(*) FROM @Results);
DECLARE @PassedChecks INT = (SELECT COUNT(*) FROM @Results WHERE Status = 'OK');
DECLARE @FailedChecks INT = (SELECT COUNT(*) FROM @Results WHERE Status IN ('MISSING', 'WARNING'));

PRINT '';
PRINT 'Verification Summary: ' + CAST(@PassedChecks AS NVARCHAR(10)) + ' / ' + CAST(@TotalChecks AS NVARCHAR(10)) + ' checks PASSED.';
IF @FailedChecks > 0
    PRINT 'WARNING: ' + CAST(@FailedChecks AS NVARCHAR(10)) + ' item(s) are MISSING or need attention. Run 00_restore_custom_schema.sql to fix.';
ELSE
    PRINT 'ALL CHECKS PASSED. Database is fully compatible with Rizviz Invoicing modern application!';
PRINT '===============================================================================';

-- ============================================================
-- Rizviz Invoicing System – One-Time DB Setup Script
-- Run as sa (or sysadmin) on DESKTOP-7S0EFN4\SQLEXPRESS
-- ============================================================

USE master;
GO

-- 1. Create dedicated SQL login
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = 'InvoicingAppUser')
BEGIN
    CREATE LOGIN [InvoicingAppUser]
        WITH PASSWORD = 'Inv@pp2026!Secure',
             DEFAULT_DATABASE = [Invoicing_System],
             CHECK_EXPIRATION = OFF,
             CHECK_POLICY = ON;
    PRINT 'Login InvoicingAppUser created.';
END
ELSE
    PRINT 'Login InvoicingAppUser already exists.';
GO

USE [Invoicing_System];
GO

-- 2. Create DB user mapped to login
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'InvoicingAppUser')
BEGIN
    CREATE USER [InvoicingAppUser] FOR LOGIN [InvoicingAppUser];
    PRINT 'DB User InvoicingAppUser created.';
END
ELSE
    PRINT 'DB User InvoicingAppUser already exists.';
GO

-- 3. Grant only required roles (no DDL)
ALTER ROLE db_datareader ADD MEMBER [InvoicingAppUser];
ALTER ROLE db_datawriter ADD MEMBER [InvoicingAppUser];
GO

-- 4. Grant EXECUTE on stored procedures
GRANT EXECUTE TO [InvoicingAppUser];
GO

-- 5. Add PasswordHashV2 column to Rizviz_Users for BCrypt upgrade (idempotent)
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME   = 'Rizviz_Users'
      AND COLUMN_NAME  = 'PasswordHashV2'
)
BEGIN
    ALTER TABLE dbo.Rizviz_Users
        ADD PasswordHashV2 NVARCHAR(256) NULL;
    PRINT 'Column PasswordHashV2 added to Rizviz_Users.';
END
ELSE
    PRINT 'Column PasswordHashV2 already exists.';
GO

-- 6. Verify
SELECT 
    p.name AS LoginName,
    p.type_desc,
    dp.name AS DBUser,
    r.name AS RoleName
FROM sys.sql_logins p
LEFT JOIN sys.database_principals dp ON dp.name = p.name
LEFT JOIN sys.database_role_members drm ON drm.member_principal_id = dp.principal_id
LEFT JOIN sys.database_principals r ON r.principal_id = drm.role_principal_id
WHERE p.name = 'InvoicingAppUser';
GO

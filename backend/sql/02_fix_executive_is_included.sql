-- ==============================================================================================
-- Script: 02_fix_executive_is_included.sql
-- Purpose: Safely update existing incorrect is_included = 0 rows back to 1 (PB default).
-- Rules:
--   1. Only updates rows where is_included = 0 or is_included IS NULL.
--   2. Preserves user manual edits: skips rows where user manually unchecked is_included
--      (verified via dbo.profile_invoice_audit_log where field_name = 'is_included').
--   3. Fully idempotent, wrapped in a TRANSACTION with TRY...CATCH and error rollback.
-- ==============================================================================================

SET NOCOUNT ON;

BEGIN TRANSACTION;

BEGIN TRY
    DECLARE @AffectedCount INT = 0;

    -- Pre-check count
    SELECT @AffectedCount = COUNT(*)
    FROM dbo.Profile_invoicing pi
    WHERE (pi.is_included = 0 OR pi.is_included IS NULL)
      AND NOT EXISTS (
          SELECT 1 
          FROM dbo.profile_invoice_audit_log al 
          WHERE al.cmp_prof_invoice_code = pi.cmp_prof_invoice_code 
            AND al.field_name = 'is_included'
      );

    PRINT 'Rows identified for fix (no manual audit entry): ' + CAST(@AffectedCount AS NVARCHAR(10));

    IF @AffectedCount > 0
    BEGIN
        UPDATE pi
        SET pi.is_included = 1
        FROM dbo.Profile_invoicing pi
        WHERE (pi.is_included = 0 OR pi.is_included IS NULL)
          AND NOT EXISTS (
              SELECT 1 
              FROM dbo.profile_invoice_audit_log al 
              WHERE al.cmp_prof_invoice_code = pi.cmp_prof_invoice_code 
                AND al.field_name = 'is_included'
          );

        DECLARE @RowsUpdated INT = @@ROWCOUNT;
        PRINT 'Successfully updated ' + CAST(@RowsUpdated AS NVARCHAR(10)) + ' row(s) to is_included = 1.';
    END
    ELSE
    BEGIN
        PRINT 'No rows require fixing. Database is already in desired state.';
    END;

    COMMIT TRANSACTION;
    PRINT 'TRANSACTION COMMITTED SUCCESSFULLY.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    PRINT 'ERROR OCCURRED: ' + ERROR_MESSAGE();
    THROW;
END CATCH;


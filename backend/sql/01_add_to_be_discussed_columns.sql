-- ============================================================================
-- Migration: Add To Be Discussed flag & notes to dbo.Profile_invoicing
-- Idempotent: Can be run multiple times safely
-- ============================================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.Profile_invoicing') 
      AND name = 'to_be_discussed'
)
BEGIN
    ALTER TABLE dbo.Profile_invoicing 
    ADD to_be_discussed BIT NOT NULL CONSTRAINT DF_Profile_invoicing_to_be_discussed DEFAULT 0;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.Profile_invoicing') 
      AND name = 'discuss_note'
)
BEGIN
    ALTER TABLE dbo.Profile_invoicing 
    ADD discuss_note NVARCHAR(500) NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.Profile_invoicing') 
      AND name = 'discuss_marked_by'
)
BEGIN
    ALTER TABLE dbo.Profile_invoicing 
    ADD discuss_marked_by NVARCHAR(100) NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.Profile_invoicing') 
      AND name = 'discuss_marked_time'
)
BEGIN
    ALTER TABLE dbo.Profile_invoicing 
    ADD discuss_marked_time DATETIME2 NULL;
END;


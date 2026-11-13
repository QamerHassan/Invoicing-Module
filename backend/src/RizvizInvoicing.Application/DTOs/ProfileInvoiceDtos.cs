using System.Collections.Generic;

namespace RizvizInvoicing.Application.DTOs;

public class ProfileInvoiceRowDto
{
    public int? CmpProfInvoiceCode { get; set; }
    public decimal? EntityCode { get; set; }
    public string? EntityName { get; set; }
    public int InvoiceTo { get; set; }
    public string? InvoiceToName { get; set; }
    public string InvoiceMonth { get; set; } = string.Empty;
    public decimal? ChargePercent { get; set; }
    public decimal? TotalIncomePkr { get; set; }
    public decimal? ChargedAmtPkr { get; set; }
    public decimal? ChargedAmtUsd { get; set; }
    public int? ExchangeRateCode { get; set; }
    public string? Status { get; set; }
    public string? Remarks { get; set; }
    public decimal? Arrears { get; set; }
    public string? Shortcode { get; set; }
    public decimal? ShareAmount { get; set; }
    public int? Ccy { get; set; }
    public int? InvoiceFrom { get; set; }
    public int? PrfownCode { get; set; }
    public string? ProfileOwnerName { get; set; }
    public int? PrfgrpOwnCode { get; set; }
    public string? GroupOwnerName { get; set; }
    public string? ResourceType { get; set; }
    public int? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? Stack { get; set; }
    public int? BranchCode { get; set; }
    public bool IsForeign { get; set; }
    public int? SecondaryDevCode { get; set; }
    public string? SecondaryDevName { get; set; }
    public int? TotalUsdCost { get; set; }
    public string? InvoiceNumber { get; set; }
    public decimal? ExchangeRate { get; set; }
    public int? ChargTypeCode { get; set; }
    public string? SupportStatus { get; set; }
    public int? InterviewCode { get; set; }
    public int? InterviewSeqCode { get; set; }
    public int? MonthDays { get; set; }
    public int? ProRateDays { get; set; }
    public string Source { get; set; } = string.Empty;
    public string? ServiceHeadName { get; set; }
    public bool IsIncluded { get; set; } = true;
    public bool IsExecutive { get; set; } = false;
}

public class ProfileInvoiceDryRunResult
{
    public int GroupOwnerCode { get; set; }
    public string GroupOwnerName { get; set; } = string.Empty;
    public string MonthYear { get; set; } = string.Empty;
    public decimal ExchangeRate { get; set; }
    public bool AlreadyExists { get; set; }
    public string? WarningMessage { get; set; }
    public int ChildOwnersCount { get; set; }
    public List<int> OwnerCodes { get; set; } = new();
    public Dictionary<string, int> CountsBySource { get; set; } = new();
    public decimal TotalUsdSum { get; set; }
    public decimal TotalUsdCostSum { get; set; }
    public decimal TotalShareAmountSum { get; set; }
    public decimal TotalArrearsSum { get; set; }
    public decimal TotalPkrSum { get; set; }
    public List<ProfileInvoiceRowDto> Rows { get; set; } = new();
}

/// <summary>
/// Request body for POST /api/profile-invoices/save.
/// The server ignores any amounts in the payload and recomputes everything
/// server-side before inserting — client payload is used only for selection.
/// </summary>
public class ProfileInvoiceSaveRequest
{
    /// <summary>Profile Group Owner code (PrfOwn_code with is_profgrp_owner='Y').</summary>
    public int GroupOwnerCode { get; set; }

    /// <summary>Invoice month in legacy format, e.g. "SEP26".</summary>
    public string MonthYear { get; set; } = string.Empty;

    /// <summary>Username of the user posting the invoices (stored in insert_by).</summary>
    public string InsertedBy { get; set; } = string.Empty;
}

/// <summary>
/// Result returned by the Save/Post operation.
/// </summary>
public class ProfileInvoiceSaveResult
{
    public int GroupOwnerCode { get; set; }
    public string GroupOwnerName { get; set; } = string.Empty;
    public string MonthYear { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }

    /// <summary>Number of rows inserted into Profile_invoicing.</summary>
    public int RowsInserted { get; set; }

    /// <summary>Range of PCOM sequence numbers allocated.</summary>
    public long FirstPcomCode { get; set; }
    public long LastPcomCode { get; set; }

    public decimal TotalUsdSum { get; set; }
    public decimal TotalUsdCostSum { get; set; }
    public decimal TotalShareAmountSum { get; set; }
    public decimal TotalArrearsSum { get; set; }
    public decimal TotalPkrSum { get; set; }

    /// <summary>Row-level breakdown with the assigned cmp_prof_invoice_code.</summary>
    public List<ProfileInvoiceSavedRowDto> SavedRows { get; set; } = new();
}

public class ProfileInvoiceSavedRowDto
{
    public long CmpProfInvoiceCode { get; set; }
    public decimal? EntityCode { get; set; }
    public string? EntityName { get; set; }
    public int? PrfownCode { get; set; }
    public string? ProfileOwnerName { get; set; }
    public int? ChargTypeCode { get; set; }
    public string? ResourceType { get; set; }
    public decimal? TotalIncomePkr { get; set; }
    public decimal? ChargedAmtUsd { get; set; }
    public decimal? ExchangeRate { get; set; }
    public string Source { get; set; } = string.Empty;
    public string? ServiceHeadName { get; set; }
    public bool IsIncluded { get; set; } = true;
    public bool IsExecutive { get; set; } = false;
}

public class ProfileInvoiceRowUpdateRequest
{
    public string? InvoiceNumber { get; set; }
    public string? Remarks { get; set; }
    public string? Status { get; set; }
    public decimal? TotalIncomePkr { get; set; }
    public decimal? ChargedAmtUsd { get; set; }
    public decimal? ChargePercent { get; set; }
    public decimal? ExchangeRate { get; set; }
    public decimal? Arrears { get; set; }
    public decimal? ShareAmount { get; set; }
    public bool? IsIncluded { get; set; }
    public decimal? TotalCost { get; set; }
    public decimal? AgreedRate { get; set; }
    public int? ProRateDays { get; set; }
    public int? MonthDays { get; set; }
    public string? SalaryRate { get; set; }
}

public class ProfileInvoiceProjectUpdateRequest
{
    public decimal? AgreedRate { get; set; }
    public int? ProRateDays { get; set; }
    public int? MonthDays { get; set; }
    public string? SalaryRate { get; set; }
    public bool? IsIncluded { get; set; }
    public string? ProjectName { get; set; }
    public string? JobType { get; set; }
    public string? ProjStatus { get; set; }
    public string? StartEndDate { get; set; }
    public string? ProfileNature { get; set; }
    public string? Stack { get; set; }
    public string MonthYear { get; set; } = string.Empty;
    public int GroupOwnerCode { get; set; }
}

public class ProfileInvoiceRowUpdateResponse
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public ProfileInvoiceRowDto? UpdatedRow { get; set; }
    public decimal TotalUsdSum { get; set; }
    public decimal TotalUsdCostSum { get; set; }
    public decimal TotalShareAmountSum { get; set; }
    public decimal TotalArrearsSum { get; set; }
    public decimal TotalPkrSum { get; set; }
    public ProfileInvoiceExcelViewResult? ExcelView { get; set; }
}

public class ProfileInvoiceExcelViewRowDto
{
    public long? CmpProfInvoiceCode { get; set; }
    public bool? IsIncluded { get; set; }
    public bool? IsExecutive { get; set; }
    public string? ProfileOwner { get; set; }
    public int? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? ServiceHead { get; set; }
    public decimal? FinalUsd { get; set; }
    public decimal? ChargedAmtUsd { get; set; }
    public decimal? TotalCost { get; set; }
    public decimal? AgreedRate { get; set; }
    public string? HoursDays { get; set; }
    public int? ProDays { get; set; }
    public int? MonthDays { get; set; }
    public decimal? ActualCharges { get; set; }
    public decimal? OtherCharge { get; set; }
    public string? SalaryRate { get; set; }
    public string? StartEndDate { get; set; }
    public string? ProjStatus { get; set; }
    public string? Stack { get; set; }
    public int? BranchCode { get; set; }
    public bool IsForeign { get; set; }
    public string? JobType { get; set; }
    public string? ProfileNature { get; set; }
    public string? HandledFrom { get; set; }
    public string RowType { get; set; } = "Detail"; // "ProjectHeader", "Detail", "Standalone", "Blank"

    /// <summary>PKR amount stored on the row, used to emit =ROUND(PKR/Rate,0) formula in Excel.</summary>
    public decimal? ChargedAmtPkr { get; set; }

    /// <summary>Exchange rate stored on the row, used to emit =ROUND(PKR/Rate,0) formula in Excel.</summary>
    public decimal? ExchangeRate { get; set; }

    /// <summary>Share amount stored on the row, used to emit share amount + converted amount formula in Excel.</summary>
    public decimal? ShareAmount { get; set; }

    /// <summary>Flag indicating row is marked for discussion.</summary>
    public bool ToBeDiscussed { get; set; }

    /// <summary>Flag indicating row is marked for discussion (for Excel View row highlight).</summary>
    public bool IsToBeDiscussed { get; set; }

    /// <summary>Flag indicating row is processed.</summary>
    public bool IsProcessed { get; set; }

    /// <summary>Invoice codes associated with this row (for project block or detail row).</summary>
    public List<long> ChildInvoiceCodes { get; set; } = new();
}

public class ProfileInvoiceExcelViewResult
{
    public int GroupOwnerCode { get; set; }
    public string GroupOwnerName { get; set; } = string.Empty;
    public string MonthYear { get; set; } = string.Empty;
    public bool IsFinalized { get; set; }
    public decimal TotalCostSum { get; set; }
    public decimal ActualChargesSum { get; set; }
    public decimal OtherChargeSum { get; set; }
    public decimal TotalInvoice { get; set; }
    public decimal AgreedRateSum { get; set; }
    public decimal FinalUsdSum { get; set; }
    public int TotalSavedRows { get; set; }
    public int TotalProjectBlocks { get; set; }
    public List<ProfileInvoiceExcelViewRowDto> Rows { get; set; } = new();
}

public class SendProfileInvoiceEmailRequest
{
    public int GroupOwnerCode { get; set; }
    public string Month { get; set; } = string.Empty;
    public string? ReplyToEmail { get; set; }
    public string ToEmail { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;

    // Multi-sender optional fields
    public string? SenderEmail { get; set; }
    public string? AppPassword { get; set; }
    public bool RememberSettings { get; set; }
    public bool? ProcessedOnly { get; set; }
    public bool ExcludeToBeDiscussed { get; set; } = true;
    public List<long>? SpecificCodes { get; set; }
}

public class ProfileInvoiceProcessedRowDto
{
    public long CmpProfInvoiceCode { get; set; }
    public int PrfownCode { get; set; }
    public string ProfileName { get; set; } = string.Empty;
    public int PrfgrpOwnCode { get; set; }
    public string PrfgrpOwnName { get; set; } = string.Empty;
    public int? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? Stack { get; set; }
    public int? BranchCode { get; set; }
    public bool IsForeign { get; set; }
    public int InvoiceTo { get; set; }
    public string InvoiceToName { get; set; } = string.Empty;
    public string InvoiceMonth { get; set; } = string.Empty;
    public decimal TotalIncomePkr { get; set; }
    public decimal ChargedAmtPkr { get; set; }
    public decimal ChargedAmtUsd { get; set; }
    public int? Ccy { get; set; }
    public string? Status { get; set; }
    public string? InsertBy { get; set; }
    public System.DateTime? InsertTime { get; set; }
}

public class ProfileInvoiceUnprocessedRowDto
{
    public int PrfownCode { get; set; }
    public string ProfileName { get; set; } = string.Empty;
    public string InvoiceMonth { get; set; } = string.Empty;
    public decimal TotalCost { get; set; }
    public int CompanyRows { get; set; }
    public int InterviewRows { get; set; }
    public int RecurringRows { get; set; }
    public int PendingRows { get; set; }
    public decimal TotalPendingUsd { get; set; }
}

public class ProfileInvoiceUnprocessedResult
{
    public string MonthYear { get; set; } = string.Empty;
    public int TotalUnprocessedOwners { get; set; }
    public decimal TotalCostSum { get; set; }
    public int TotalPendingRows { get; set; }
    public decimal TotalPendingUsd { get; set; }
    public List<ProfileInvoiceUnprocessedRowDto> Rows { get; set; } = new();
}

public class ProfileInvoiceAuditLogDto
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public System.DateTime Timestamp { get; set; }
    public string InvoiceMonth { get; set; } = string.Empty;
    public long? CmpProfInvoiceCode { get; set; }
    public int? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? Stack { get; set; }
    public int? BranchCode { get; set; }
    public bool IsForeign { get; set; }
    public string FieldName { get; set; } = string.Empty;
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public bool IsMonthFinalized { get; set; }
}

public class ProfileInvoiceDiscussedRowDto
{
    public long CmpProfInvoiceCode { get; set; }
    public int PrfownCode { get; set; }
    public string ProfileName { get; set; } = string.Empty;
    public int PrfgrpOwnCode { get; set; }
    public string PrfgrpOwnName { get; set; } = string.Empty;
    public int? ProjectCode { get; set; }
    public string? ProjectName { get; set; }
    public string? Stack { get; set; }
    public int? BranchCode { get; set; }
    public bool IsForeign { get; set; }
    public string? ServiceHead { get; set; }
    public string InvoiceMonth { get; set; } = string.Empty;
    public decimal ChargedAmtUsd { get; set; }
    public decimal TotalCost { get; set; }
    public string Status { get; set; } = "P";
    public string? Remarks { get; set; }
    public bool IsIncluded { get; set; }
    public string? InvoiceNumber { get; set; }
    public bool ToBeDiscussed { get; set; } = true;
    public string? DiscussNote { get; set; }
    public string? DiscussMarkedBy { get; set; }
    public System.DateTime? DiscussMarkedTime { get; set; }
    public string? LastModifiedBy { get; set; }
    public System.DateTime? LastModifiedTime { get; set; }
}

public class ProfileInvoiceAddDiscussedRequest
{
    public List<long> Codes { get; set; } = new();
    public string? Note { get; set; }
}

public class ProfileInvoiceRemoveDiscussedRequest
{
    public List<long> Codes { get; set; } = new();
}

public class ProfileInvoiceUpdateDiscussNoteRequest
{
    public string? Note { get; set; }
}

public class ProfileInvoiceProcessRequest
{
    public List<long> Codes { get; set; } = new();
}

public class ProfileInvoiceUnprocessRequest
{
    public List<long> Codes { get; set; } = new();
    public List<int>? OwnerCodes { get; set; }
    public string? Month { get; set; }
}

public class ProfileInvoiceProcessedProfileDto
{
    public int OwnerCode { get; set; }
    public string OwnerName { get; set; } = string.Empty;
    public string Month { get; set; } = string.Empty;
    public decimal TotalCost { get; set; }
    public decimal TotalInvoice { get; set; }
    public decimal TotalActual { get; set; }
    public decimal TotalOther { get; set; }
    public int RowsCount { get; set; }
    public List<long> InvoiceCodes { get; set; } = new();
}

public class ProfileInvoiceProcessByOwnerRequest
{
    public List<int> PrfownCodes { get; set; } = new();
    public string Month { get; set; } = string.Empty;
}

/// <summary>
/// Request to generate (save) invoices for a profile owner + month, then return the Excel view.
/// If invoices already exist for the resolved group owner, the generate step is skipped safely.
/// </summary>
public class ProfileInvoiceGenerateOpenRequest
{
    /// <summary>Individual or group prfown_code from the Unprocessed tab.</summary>
    public int PrfownCode { get; set; }

    /// <summary>Invoice month e.g. "SEP26".</summary>
    public string Month { get; set; } = string.Empty;
}

/// <summary>
/// Result of generate-open: group owner resolved, rows generated (or already existed), Excel view returned.
/// </summary>
public class ProfileInvoiceGenerateOpenResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public int GroupOwnerCode { get; set; }
    public string GroupOwnerName { get; set; } = string.Empty;
    public bool AlreadyExisted { get; set; }
    public int RowsGenerated { get; set; }
    public ProfileInvoiceExcelViewResult? ExcelView { get; set; }
}


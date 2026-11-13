
using System.Threading;
using System.Threading.Tasks;
using RizvizInvoicing.Application.DTOs;

namespace RizvizInvoicing.Application.Interfaces;

public interface IProfileInvoicingService
{
    Task<ProfileInvoiceDryRunResult> CalculateDryRunAsync(int groupOwnerCode, string monthYear, bool bypassDuplicateGuard = false, CancellationToken ct = default);

    /// <summary>
    /// Save/Post profile invoices for one Group Owner + Month.
    /// Server-side: recalculates amounts, enforces duplicate guard,
    /// acquires sp_getapplock, allocates PCOM sequences, inserts all rows
    /// in a single transaction with status='P'.
    /// </summary>
    Task<ProfileInvoiceSaveResult> SaveAsync(ProfileInvoiceSaveRequest request, CancellationToken ct = default);

    /// <summary>
    /// Load existing saved profile invoice rows from dbo.Profile_invoicing.
    /// </summary>
    Task<List<ProfileInvoiceRowDto>> GetSavedRowsAsync(int groupOwnerCode, string monthYear, CancellationToken ct = default);

    /// <summary>
    /// Update inline editable fields of a saved row and recalculate amounts/totals.
    /// </summary>
    Task<ProfileInvoiceRowUpdateResponse> UpdateRowAsync(long cmpProfInvoiceCode, ProfileInvoiceRowUpdateRequest request, string username, CancellationToken ct = default);

    /// <summary>
    /// Update editable project fields (agreed rate, pro-rate days, month days, salary rate) from Excel View.
    /// </summary>
    Task<ProfileInvoiceRowUpdateResponse> UpdateProjectRowAsync(int projectCode, string monthYear, int groupOwnerCode, ProfileInvoiceProjectUpdateRequest request, string username, CancellationToken ct = default);

    /// <summary>
    /// Checks whether an invoice month has already been finalized in dbo.final_invoicing.
    /// </summary>
    Task<bool> IsMonthFinalizedAsync(string monthYear, CancellationToken ct = default);

    /// <summary>
    /// Get structured Excel view matching PB cb_10 layout for saved rows of a Group Owner + Month.
    /// </summary>
    Task<ProfileInvoiceExcelViewResult> GetExcelViewAsync(int groupOwnerCode, string monthYear, CancellationToken ct = default);

    /// <summary>
    /// Get structured Excel view matching PB cb_10 layout for saved rows of a Group Owner + Month.
    /// When processedOnly=true, filters to is_processed=1 and restricts to that specific recipient owner's processed rows.
    /// </summary>
    Task<ProfileInvoiceExcelViewResult> GetExcelViewAsync(int groupOwnerCode, string monthYear, bool processedOnly, int? specificOwnerCode = null, CancellationToken ct = default, bool excludeToBeDiscussed = false);

    /// <summary>
    /// Generate real .xlsx file bytes matching PB cb_10 layout via ClosedXML.
    /// </summary>
    Task<byte[]> GetExcelDownloadAsync(int groupOwnerCode, string monthYear, CancellationToken ct = default);

    /// <summary>
    /// Generate real .xlsx file bytes matching PB cb_10 layout via ClosedXML.
    /// When processedOnly=true, generates Excel containing only that recipient's processed invoice records.
    /// </summary>
    Task<byte[]> GetExcelDownloadAsync(int groupOwnerCode, string monthYear, bool processedOnly, int? specificOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Generate real .xlsx file bytes matching PB cb_10 layout via ClosedXML.
    /// When excludeToBeDiscussed=true, filters out rows where to_be_discussed = 1.
    /// </summary>
    Task<byte[]> GetExcelDownloadAsync(int groupOwnerCode, string monthYear, bool processedOnly, bool excludeToBeDiscussed, int? specificOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Get processed profile invoice rows for a month (matching PB dw_status_processed).
    /// </summary>
    Task<List<ProfileInvoiceProcessedRowDto>> GetProcessedInvoicesAsync(string month, int? groupOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Get profile-wise aggregate of processed invoices (owner code, name, month, total cost, total invoice, rows count).
    /// </summary>
    Task<List<ProfileInvoiceProcessedProfileDto>> GetProcessedProfilesAsync(string month, int? groupOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Check unprocessed invoices count and pending amount for a specific profile owner + month.
    /// </summary>
    Task<(int UnprocessedCount, decimal UnprocessedUsd, string OwnerName)> GetOwnerUnprocessedStatusAsync(
        int ownerCode, string month, CancellationToken ct = default);

    /// <summary>
    /// Get unprocessed profile invoice owners and pending row counts for a month (matching PB dw_status_unprocessed).
    /// </summary>
    Task<ProfileInvoiceUnprocessedResult> GetUnprocessedInvoicesAsync(string month, CancellationToken ct = default);

    /// <summary>
    /// Get change audit log entries from dbo.profile_invoice_audit_log.
    /// </summary>
    Task<List<ProfileInvoiceAuditLogDto>> GetAuditLogsAsync(string? month = null, int? groupOwnerCode = null, long? cmpProfInvoiceCode = null, CancellationToken ct = default);

    /// <summary>
    /// Get invoices marked as needing discussion (to_be_discussed = 1).
    /// </summary>
    Task<List<ProfileInvoiceDiscussedRowDto>> GetDiscussedInvoicesAsync(string month, int? groupOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Mark invoice codes as To Be Discussed (to_be_discussed = 1) with optional note.
    /// Creates audit log if changed.
    /// </summary>
    Task<(bool Success, string Message, int UpdatedCount)> AddToBeDiscussedAsync(
        List<long> codes, string? note, string username, CancellationToken ct = default);

    /// <summary>
    /// Remove invoice codes from To Be Discussed (to_be_discussed = 0).
    /// Creates audit log if changed.
    /// </summary>
    Task<(bool Success, string Message, int UpdatedCount)> RemoveFromToBeDiscussedAsync(
        List<long> codes, string username, CancellationToken ct = default);

    /// <summary>
    /// Update discuss note for an invoice code.
    /// </summary>
    Task<(bool Success, string Message)> UpdateDiscussNoteAsync(
        long code, string? note, string username, CancellationToken ct = default);

    /// <summary>
    /// Mark invoice codes as Processed (is_processed = 1).
    /// Creates audit log if changed.
    /// </summary>
    Task<(bool Success, string Message, int UpdatedCount)> ProcessInvoicesAsync(
        List<long> codes, string username, CancellationToken ct = default);

    /// <summary>
    /// Process all unprocessed invoices for the given owner codes and month.
    /// Finds invoice codes from dbo.Profile_invoicing, then processes them.
    /// </summary>
    Task<(bool Success, string Message, int UpdatedCount)> ProcessInvoicesByOwnerAsync(
        List<int> prfownCodes, string month, string username, CancellationToken ct = default);

    /// <summary>
    /// Revert invoice codes from Processed to Unprocessed (is_processed = 0).
    /// Creates audit log if changed.
    /// </summary>
    Task<(bool Success, string Message, int UpdatedCount)> UnprocessInvoicesAsync(
        List<long> codes, string username, CancellationToken ct = default);

    /// <summary>
    /// Get distinct normalized invoiced months from dbo.Profile_invoicing, sorted latest first.
    /// If groupOwnerCode is specified, only months with rows for that owner are returned.
    /// </summary>
    Task<List<string>> GetInvoicedMonthsAsync(int? groupOwnerCode = null, CancellationToken ct = default);

    /// <summary>
    /// Generate (save) invoices for the given prfown_code + month if not already generated,
    /// then return the Excel view. Safe to call when rows already exist — skips generation.
    /// </summary>
    Task<ProfileInvoiceGenerateOpenResult> GenerateAndOpenAsync(int prfownCode, string month, string username, CancellationToken ct = default);
}

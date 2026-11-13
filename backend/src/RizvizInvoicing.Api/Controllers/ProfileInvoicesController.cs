using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/profile-invoices")]
[Tags("ProfileInvoices")]
[Authorize]
public class ProfileInvoicesController : ControllerBase
{
    private readonly IProfileInvoicingService _profileInvoicingService;
    private readonly IEmailService _emailService;
    private readonly IUserEmailSettingsService _userEmailSettingsService;
    private readonly Microsoft.Extensions.Logging.ILogger<ProfileInvoicesController> _logger;

    public ProfileInvoicesController(
        IProfileInvoicingService profileInvoicingService,
        IEmailService emailService,
        IUserEmailSettingsService userEmailSettingsService,
        Microsoft.Extensions.Logging.ILogger<ProfileInvoicesController> logger)
    {
        _profileInvoicingService = profileInvoicingService;
        _emailService = emailService;
        _userEmailSettingsService = userEmailSettingsService;
        _logger = logger;
    }

    /// <summary>
    /// Calculate profile invoicing in DRY-RUN mode (writes nothing to database).
    /// Merges 4 sources: Company Invoicing, Interviews, Recurring Projects, Marketing Charges.
    /// </summary>
    [HttpGet("calculate-dry-run")]
    [ProducesResponseType(typeof(ProfileInvoiceDryRunResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CalculateDryRun(
        [FromQuery] int groupOwnerCode,
        [FromQuery] string month,
        [FromQuery] bool bypassDuplicateGuard = false,
        CancellationToken ct = default)
    {
        if (groupOwnerCode <= 0)
        {
            return BadRequest(new { message = "Valid Profile Group Owner code is required." });
        }

        if (string.IsNullOrWhiteSpace(month))
        {
            return BadRequest(new { message = "Invoice month is required (e.g. SEP26)." });
        }

        var result = await _profileInvoicingService.CalculateDryRunAsync(groupOwnerCode, month, bypassDuplicateGuard, ct);
        return Ok(result);
    }

    /// <summary>
    /// Save / Post profile invoices for one Group Owner + Month.
    /// Amounts are recomputed server-side; client payload is used only for selection.
    /// Once posted (status='P'), rows cannot be un-posted or deleted — matches legacy behaviour.
    /// </summary>
    /// <remarks>
    /// Returns 409 Conflict if invoices already exist for this Group Owner + Month.
    /// Returns 422 Unprocessable Entity if calculation yields zero rows.
    /// </remarks>
    [HttpPost("save")]
    [ProducesResponseType(typeof(ProfileInvoiceSaveResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Save(
        [FromBody] ProfileInvoiceSaveRequest request,
        CancellationToken ct)
    {
        if (request is null)
            return BadRequest(new { message = "Request body is required." });

        if (request.GroupOwnerCode <= 0)
            return BadRequest(new { message = "Valid groupOwnerCode is required." });

        if (string.IsNullOrWhiteSpace(request.MonthYear))
            return BadRequest(new { message = "monthYear is required (e.g. SEP26)." });

        if (string.IsNullOrWhiteSpace(request.InsertedBy))
            return BadRequest(new { message = "insertedBy is required." });

        var result = await _profileInvoicingService.SaveAsync(request, ct);

        if (!result.Success)
        {
            // Distinguish: already-posted → 409; no rows → 422; other failure → 500
            if (result.ErrorMessage?.Contains("already exist") == true)
                return Conflict(result);

            if (result.ErrorMessage?.Contains("Nothing to save") == true)
                return UnprocessableEntity(result);

            return StatusCode(StatusCodes.Status500InternalServerError, result);
        }

        return Ok(result);
    }

    /// <summary>
    /// Load existing saved profile invoice rows from dbo.Profile_invoicing.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<ProfileInvoiceRowDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetSavedRows(
        [FromQuery] int groupOwnerCode,
        [FromQuery] string monthYear,
        CancellationToken ct)
    {
        if (groupOwnerCode <= 0)
            return BadRequest(new { message = "Valid Profile Group Owner code is required." });

        if (string.IsNullOrWhiteSpace(monthYear))
            return BadRequest(new { message = "monthYear is required (e.g. SEP26)." });

        var rows = await _profileInvoicingService.GetSavedRowsAsync(groupOwnerCode, monthYear, ct);
        return Ok(rows);
    }

    /// <summary>
    /// Check whether an invoice month has been finalized in dbo.final_invoicing.
    /// </summary>
    [HttpGet("is-finalized")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> IsMonthFinalized([FromQuery] string month, CancellationToken ct)
    {
        bool isFinalized = await _profileInvoicingService.IsMonthFinalizedAsync(month, ct);
        return Ok(new { month, isFinalized });
    }

    /// <summary>
    /// Get distinct normalized invoiced months from dbo.Profile_invoicing, sorted latest first.
    /// If ownerCode is supplied, returns months for that owner only.
    /// </summary>
    [HttpGet("months")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetInvoicedMonths([FromQuery] int? ownerCode, CancellationToken ct)
    {
        var months = await _profileInvoicingService.GetInvoicedMonthsAsync(ownerCode, ct);
        return Ok(months);
    }

    /// <summary>
    /// Update editable fields (invoice_number, remarks, status, amounts, include checkbox) of a saved profile invoice row.
    /// Recalculates charged amounts and totals server-side.
    /// </summary>
    [HttpPatch("{cmpProfInvoiceCode:long}")]
    [ProducesResponseType(typeof(ProfileInvoiceRowUpdateResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateRow(
        [FromRoute] long cmpProfInvoiceCode,
        [FromBody] ProfileInvoiceRowUpdateRequest request,
        CancellationToken ct)
    {
        if (cmpProfInvoiceCode <= 0)
            return BadRequest(new { message = "Valid cmpProfInvoiceCode is required." });

        if (request is null)
            return BadRequest(new { message = "Request body is required." });

        var username = User.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.UpdateRowAsync(cmpProfInvoiceCode, request, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(result);
    }

    /// <summary>
    /// Update editable project fields (Agreed Rate, Days, Salary Rate) from Excel View.
    /// Recalculates pro-rate amounts and Excel View totals live.
    /// </summary>
    [HttpPatch("project/{projectCode:int}")]
    [ProducesResponseType(typeof(ProfileInvoiceRowUpdateResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateProject(
        [FromRoute] int projectCode,
        [FromBody] ProfileInvoiceProjectUpdateRequest request,
        CancellationToken ct)
    {
        if (projectCode <= 0)
            return BadRequest(new { message = "Valid projectCode is required." });
        if (request is null)
            return BadRequest(new { message = "Request body is required." });

        var username = User.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.UpdateProjectRowAsync(projectCode, request.MonthYear, request.GroupOwnerCode, request, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(result);
    }

    /// <summary>
    /// Get structured Excel view matching PB cb_10 layout for saved rows of a Group Owner + Month.
    /// Supports both GET and POST requests. Automatically resolves child to group owner and
    /// generates invoice rows from source tables if not already generated.
    /// </summary>
    [HttpGet("excel-view")]
    [HttpPost("excel-view")]
    [ProducesResponseType(typeof(ProfileInvoiceExcelViewResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetExcelView(
        [FromQuery] int? groupOwnerCode,
        [FromQuery] string? month,
        [FromBody] ProfileInvoiceGenerateOpenRequest? bodyRequest,
        CancellationToken ct)
    {
        int code = (groupOwnerCode.HasValue && groupOwnerCode.Value > 0)
            ? groupOwnerCode.Value 
            : (bodyRequest?.PrfownCode ?? 0);
        string m = !string.IsNullOrWhiteSpace(month) 
            ? month 
            : (bodyRequest?.Month ?? "");

        if (code <= 0)
            return BadRequest(new { message = "Valid Profile Group Owner code is required." });

        if (string.IsNullOrWhiteSpace(m))
            return BadRequest(new { message = "Invoice month is required (e.g. SEP26)." });

        _logger.LogInformation("GetExcelView: fetching for owner {Owner}, month {Month}", code, m);
        try
        {
            var result = await _profileInvoicingService.GetExcelViewAsync(code, m, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetExcelView failed for owner {Owner}, month {Month}", code, m);
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "An error occurred while loading Excel view.", detail = ex.Message });
        }
    }

    /// <summary>
    /// Download real .xlsx workbook matching PB cb_10 layout for saved rows of a Group Owner + Month.
    /// When processedOnly=true, only processed invoice records (is_processed=1) for the recipient are included.
    /// </summary>
    [HttpGet("excel-download")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetExcelDownload(
        [FromQuery] int groupOwnerCode,
        [FromQuery] string month,
        [FromQuery] bool processedOnly = false,
        [FromQuery] bool excludeToBeDiscussed = false,
        [FromQuery] int? specificOwnerCode = null,
        CancellationToken ct = default)
    {
        int effectiveCode = (specificOwnerCode.HasValue && specificOwnerCode.Value > 0)
            ? specificOwnerCode.Value
            : groupOwnerCode;

        if (effectiveCode <= 0)
            return BadRequest(new { message = "Valid Profile Owner code is required." });

        if (string.IsNullOrWhiteSpace(month))
            return BadRequest(new { message = "Invoice month is required (e.g. SEP26)." });

        byte[] bytes;
        if (excludeToBeDiscussed)
        {
            bytes = await _profileInvoicingService.GetExcelDownloadAsync(
                effectiveCode, month, processedOnly, excludeToBeDiscussed: true, specificOwnerCode: effectiveCode, ct: ct);
        }
        else
        {
            bytes = await _profileInvoicingService.GetExcelDownloadAsync(
                effectiveCode, month, processedOnly, specificOwnerCode: effectiveCode, ct: ct);
        }

        string filename = processedOnly
            ? $"Processed_Invoice_{effectiveCode}_{month}.xlsx"
            : excludeToBeDiscussed
            ? $"Selected_Invoice_{effectiveCode}_{month}.xlsx"
            : $"Profile_Invoice_{effectiveCode}_{month}.xlsx";

        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename);
    }

    /// <summary>
    /// Send generated Excel invoice workbook via email attachment.
    /// Uses processed invoice records (is_processed=1) strictly belonging to the specified recipient.
    /// </summary>
    [HttpPost("send-email")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SendEmail(
        [FromBody] SendProfileInvoiceEmailRequest request,
        CancellationToken ct)
    {
        if (request is null)
            return BadRequest(new { message = "Request body is required." });

        if (request.GroupOwnerCode <= 0)
            return BadRequest(new { message = "Valid Profile Group Owner is required." });

        if (string.IsNullOrWhiteSpace(request.Month))
            return BadRequest(new { message = "Invoice month is required (e.g. SEP26)." });

        if (string.IsNullOrWhiteSpace(request.ToEmail))
            return BadRequest(new { message = "Recipient email address is required." });

        if (!request.ToEmail.Contains("@") || !request.ToEmail.Contains("."))
            return BadRequest(new { message = "Please enter a valid recipient email address format." });

        if (!string.IsNullOrWhiteSpace(request.ReplyToEmail) && (!request.ReplyToEmail.Contains("@") || !request.ReplyToEmail.Contains(".")))
            return BadRequest(new { message = "Please enter a valid Reply-To email address format." });

        if (string.IsNullOrWhiteSpace(request.Subject))
            return BadRequest(new { message = "Email Subject cannot be empty." });

        if (string.IsNullOrWhiteSpace(request.Body))
            return BadRequest(new { message = "Email message body cannot be empty." });

        try
        {
            // Email attachment uses requested filtering (by default excludeToBeDiscussed=true)
            bool isProcessed = request.ProcessedOnly ?? false;
            var bytes = await _profileInvoicingService.GetExcelDownloadAsync(
                request.GroupOwnerCode,
                request.Month,
                processedOnly: isProcessed,
                excludeToBeDiscussed: request.ExcludeToBeDiscussed,
                specificOwnerCode: request.GroupOwnerCode,
                ct: ct);

            string filename = isProcessed
                ? $"Processed_Invoice_{request.GroupOwnerCode}_{request.Month}.xlsx"
                : $"Profile_Invoice_{request.GroupOwnerCode}_{request.Month}.xlsx";

            // ── Credential resolution: Request > Saved > Default config ──
            string? activeSender = null;
            string? activePassword = null;

            if (!string.IsNullOrWhiteSpace(request.SenderEmail) && !string.IsNullOrWhiteSpace(request.AppPassword))
            {
                // (1) Credentials supplied directly in request
                activeSender = request.SenderEmail.Trim();
                activePassword = request.AppPassword;
            }
            else
            {
                // (2) Try user's saved settings
                var userId = GetCurrentUserId();
                if (userId.HasValue)
                {
                    var (savedEmail, savedPwd) = await _userEmailSettingsService.GetDecryptedAsync(userId.Value, ct);
                    if (!string.IsNullOrWhiteSpace(savedEmail) && !string.IsNullOrWhiteSpace(savedPwd))
                    {
                        activeSender  = savedEmail;
                        activePassword = savedPwd;
                    }
                }
            }

            await _emailService.SendEmailWithAttachmentAsync(
                request.ToEmail,
                request.Subject,
                request.Body,
                bytes,
                filename,
                request.ReplyToEmail,
                activeSender,
                activePassword,
                ct);

            // ── Save settings ONLY after successful send when RememberSettings=true ──
            if (request.RememberSettings
                && !string.IsNullOrWhiteSpace(request.SenderEmail)
                && !string.IsNullOrWhiteSpace(request.AppPassword))
            {
                var userId = GetCurrentUserId();
                if (userId.HasValue)
                {
                    try
                    {
                        await _userEmailSettingsService.SaveAsync(userId.Value, request.SenderEmail.Trim(), request.AppPassword, ct);
                    }
                    catch (Exception saveEx)
                    {
                        _logger.LogWarning("Failed to save email settings for user {UserId}: {Message}", userId.Value, saveEx.Message);
                    }
                }
            }

            // Mark emailed invoices as processed (is_processed = 1) so they move to the Processed tab
            try
            {
                if (request.SpecificCodes != null && request.SpecificCodes.Count > 0)
                {
                    await _profileInvoicingService.ProcessInvoicesAsync(request.SpecificCodes, User?.Identity?.Name ?? "Email", ct);
                }
                else
                {
                    await _profileInvoicingService.ProcessInvoicesByOwnerAsync(new List<int> { request.GroupOwnerCode }, request.Month, User?.Identity?.Name ?? "Email", ct);
                }
            }
            catch (Exception procEx)
            {
                _logger.LogWarning("Email sent but failed to auto-mark as processed: {Message}", procEx.Message);
            }

            return Ok(new { success = true, message = $"Email sent successfully to {request.ToEmail} with attachment {filename}." });
        }
        catch (MailKit.Security.AuthenticationException ex)
        {
            _logger.LogWarning("Email authentication failed: {Message}", ex.Message);
            return BadRequest(new { message = "Sender account ki settings galat hain, admin se rabta karo." });
        }
        catch (MailKit.Net.Smtp.SmtpCommandException ex)
        {
            _logger.LogWarning("SMTP command rejected for recipient {To}: {StatusCode} - {Message}", request.ToEmail, ex.StatusCode, ex.Message);
            return BadRequest(new { message = $"SMTP Server error ({ex.StatusCode}): {ex.Message}" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email to {To}", request.ToEmail);
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Get processed profile invoices for month and optional group owner (matches PB dw_status_processed).
    /// Accepts month or monthYear query param; defaults to current month if unspecified.
    /// Live query directly against database with zero caching.
    /// </summary>
    [HttpGet("processed")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(List<ProfileInvoiceProcessedRowDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetProcessed(
        [FromQuery] string? month = null,
        [FromQuery] string? monthYear = null,
        [FromQuery] int? groupOwnerCode = null,
        [FromQuery] int? ownerCode = null,
        CancellationToken ct = default)
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";

        string selectedMonth = !string.IsNullOrWhiteSpace(month) ? month : (!string.IsNullOrWhiteSpace(monthYear) ? monthYear : string.Empty);
        if (string.IsNullOrWhiteSpace(selectedMonth))
            selectedMonth = DateTime.UtcNow.ToString("MMMyy").ToUpperInvariant();

        int? effectiveOwner = (ownerCode.HasValue && ownerCode.Value > 0) ? ownerCode : groupOwnerCode;
        var rows = await _profileInvoicingService.GetProcessedInvoicesAsync(selectedMonth, effectiveOwner, ct);
        return Ok(rows);
    }

    /// <summary>
    /// Check unprocessed invoice count and pending amount for a specific profile owner and month.
    /// Used by Email View warning popup.
    /// </summary>
    [HttpGet("owner-unprocessed-status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetOwnerUnprocessedStatus(
        [FromQuery] int ownerCode,
        [FromQuery] string month,
        CancellationToken ct = default)
    {
        if (ownerCode <= 0)
            return BadRequest(new { message = "Valid Profile Owner code is required." });

        if (string.IsNullOrWhiteSpace(month))
            return BadRequest(new { message = "Invoice month is required (e.g. SEP26)." });

        var (count, usd, ownerName) = await _profileInvoicingService.GetOwnerUnprocessedStatusAsync(ownerCode, month, ct);
        return Ok(new
        {
            ownerCode,
            ownerName,
            month,
            hasUnprocessed = count > 0,
            unprocessedCount = count,
            unprocessedUsd = usd
        });
    }

    /// <summary>
    /// Get unprocessed profile invoices for month (matches PB dw_status_unprocessed).
    /// Accepts month or monthYear query param; defaults to current month if unspecified.
    /// Live query directly against database with zero caching.
    /// </summary>
    [HttpGet("unprocessed")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(ProfileInvoiceUnprocessedResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetUnprocessed(
        [FromQuery] string? month = null,
        [FromQuery] string? monthYear = null,
        CancellationToken ct = default)
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";

        string selectedMonth = !string.IsNullOrWhiteSpace(month) ? month : (!string.IsNullOrWhiteSpace(monthYear) ? monthYear : string.Empty);
        if (string.IsNullOrWhiteSpace(selectedMonth))
            selectedMonth = DateTime.UtcNow.ToString("MMMyy").ToUpperInvariant();

        var result = await _profileInvoicingService.GetUnprocessedInvoicesAsync(selectedMonth, ct);
        return Ok(result);
    }

    /// <summary>
    /// Get change audit log entries from dbo.profile_invoice_audit_log.
    /// </summary>
    [HttpGet("audit-logs")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(List<ProfileInvoiceAuditLogDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAuditLogs(
        [FromQuery] string? month = null,
        [FromQuery] int? groupOwnerCode = null,
        [FromQuery] long? code = null,
        CancellationToken ct = default)
    {
        var logs = await _profileInvoicingService.GetAuditLogsAsync(month, groupOwnerCode, code, ct);
        return Ok(logs);
    }

    /// <summary>
    /// Get invoices marked as needing discussion (status='D' or support_status='D' or remarks containing discussion).
    /// </summary>
    [HttpGet("to-be-discussed")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(typeof(List<ProfileInvoiceDiscussedRowDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetToBeDiscussed(
        [FromQuery] string? month = null,
        [FromQuery] int? groupOwnerCode = null,
        CancellationToken ct = default)
    {
        string selectedMonth = !string.IsNullOrWhiteSpace(month) ? month : DateTime.UtcNow.ToString("MMMyy").ToUpperInvariant();
        var rows = await _profileInvoicingService.GetDiscussedInvoicesAsync(selectedMonth, groupOwnerCode, ct);
        return Ok(rows);
    }

    /// <summary>
    /// Mark invoice codes as To Be Discussed.
    /// </summary>
    [HttpPost("to-be-discussed")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> AddToBeDiscussed(
        [FromBody] ProfileInvoiceAddDiscussedRequest request,
        CancellationToken ct = default)
    {
        if (request == null || request.Codes == null || request.Codes.Count == 0)
            return BadRequest(new { message = "Codes cannot be empty." });

        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.AddToBeDiscussedAsync(request.Codes, request.Note, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message, updatedCount = result.UpdatedCount });
    }

    /// <summary>
    /// Remove invoice codes from To Be Discussed.
    /// </summary>
    [HttpDelete("to-be-discussed")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> RemoveFromToBeDiscussed(
        [FromBody] ProfileInvoiceRemoveDiscussedRequest request,
        CancellationToken ct = default)
    {
        if (request == null || request.Codes == null || request.Codes.Count == 0)
            return BadRequest(new { message = "Codes cannot be empty." });

        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.RemoveFromToBeDiscussedAsync(request.Codes, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message, updatedCount = result.UpdatedCount });
    }

    /// <summary>
    /// Update discuss note for an invoice code.
    /// </summary>
    [HttpPatch("to-be-discussed/{code:long}/note")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateDiscussNote(
        [FromRoute] long code,
        [FromBody] ProfileInvoiceUpdateDiscussNoteRequest request,
        CancellationToken ct = default)
    {
        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.UpdateDiscussNoteAsync(code, request?.Note, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message });
    }

    /// <summary>
    /// Mark invoice codes as Processed.
    /// </summary>
    [HttpPost("process")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ProcessInvoices(
        [FromBody] ProfileInvoiceProcessRequest request,
        CancellationToken ct = default)
    {
        if (request == null || request.Codes == null || request.Codes.Count == 0)
            return BadRequest(new { message = "Codes cannot be empty." });

        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.ProcessInvoicesAsync(request.Codes, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message, updatedCount = result.UpdatedCount });
    }

    /// <summary>
    /// Process all unprocessed invoices for the given owner codes and month.
    /// </summary>
    [HttpPost("process-by-owner")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ProcessInvoicesByOwner(
        [FromBody] ProfileInvoiceProcessByOwnerRequest request,
        CancellationToken ct = default)
    {
        if (request == null || request.PrfownCodes == null || request.PrfownCodes.Count == 0)
            return BadRequest(new { message = "Owner codes cannot be empty." });
        if (string.IsNullOrWhiteSpace(request.Month))
            return BadRequest(new { message = "Month is required." });

        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.ProcessInvoicesByOwnerAsync(
            request.PrfownCodes, request.Month, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message, updatedCount = result.UpdatedCount });
    }

    /// <summary>
    /// Generate (save) invoices for a profile owner + month if not yet generated,
    /// then return the Excel view. Called when "Open" is clicked in the Unprocessed tab.
    /// Safe to call when rows already exist — skips generation, loads existing rows.
    /// Supports both POST and GET.
    /// </summary>
    [HttpPost("generate-open")]
    [HttpGet("generate-open")]
    [ProducesResponseType(typeof(ProfileInvoiceGenerateOpenResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> GenerateAndOpen(
        [FromBody] ProfileInvoiceGenerateOpenRequest? bodyRequest,
        [FromQuery] int? prfownCode,
        [FromQuery] string? month,
        CancellationToken ct = default)
    {
        int code = (bodyRequest != null && bodyRequest.PrfownCode > 0)
            ? bodyRequest.PrfownCode
            : (prfownCode ?? 0);
        string m = (bodyRequest != null && !string.IsNullOrWhiteSpace(bodyRequest.Month))
            ? bodyRequest.Month
            : (month ?? "");

        if (code <= 0)
            return BadRequest(new { message = "Valid prfownCode is required." });
        if (string.IsNullOrWhiteSpace(m))
            return BadRequest(new { message = "Month is required (e.g. SEP26)." });

        string username = User?.Identity?.Name ?? "System";
        _logger.LogInformation("GenerateAndOpen: owner {Owner}, month {Month} requested by {User}", code, m, username);

        try
        {
            var result = await _profileInvoicingService.GenerateAndOpenAsync(code, m, username, ct);

            if (!result.Success)
            {
                if (result.Message?.Contains("No invoice rows") == true ||
                    result.Message?.Contains("No rows calculated") == true ||
                    result.Message?.Contains("Nothing to save") == true)
                    return UnprocessableEntity(result);

                return BadRequest(result);
            }

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GenerateAndOpen failed for owner {Owner}, month {Month}", code, m);
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Failed to generate and open profile invoices.", detail = ex.Message });
        }
    }

    /// <summary>
    /// Move invoice codes back from Processed to Active (unprocess).
    /// </summary>
    [HttpDelete("process")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UnprocessInvoices(
        [FromBody] ProfileInvoiceUnprocessRequest request,
        CancellationToken ct = default)
    {
        if (request == null || request.Codes == null || request.Codes.Count == 0)
            return BadRequest(new { message = "Codes cannot be empty." });

        string username = User?.Identity?.Name ?? "System";
        var result = await _profileInvoicingService.UnprocessInvoicesAsync(request.Codes, username, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new { success = true, message = result.Message, updatedCount = result.UpdatedCount });
    }

    private int? GetCurrentUserId()
    {
        var idStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(idStr, out var id) ? id : null;
    }
}


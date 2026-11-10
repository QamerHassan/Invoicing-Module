using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using Serilog;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/company-invoices")]
[Tags("CompanyInvoices")]
[Authorize]
public class CompanyInvoicesController : ControllerBase
{
    private readonly IInvoicingService _invoicingService;

    public CompanyInvoicesController(IInvoicingService invoicingService)
    {
        _invoicingService = invoicingService;
    }

    /// <summary>
    /// Retrieve all company invoice records for a given billing month/year.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<CompanyInvoiceDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetCompanyInvoices([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var result = await _invoicingService.GetCompanyInvoicesAsync(monthYear, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "GetCompanyInvoices error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Retrieve profile owners and their active projects for the Profile Owners - Projects grid (matching dw_prf_invoicing).
    /// </summary>
    [HttpGet("profile-projects")]
    [ProducesResponseType(typeof(List<ProfileProjectDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetProfileProjects([FromQuery] int? profileOwnerId, CancellationToken ct)
    {
        try
        {
            var result = await _invoicingService.GetProfileProjectsAsync(profileOwnerId, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "GetProfileProjects error for ProfileOwner {ProfileOwnerId}: {Msg}", profileOwnerId, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Export company invoices in PowerBuilder uf_calculate_salary CSV/Excel layout with summary.
    /// </summary>
    [HttpGet("export-excel")]
    public async Task<IActionResult> ExportExcel([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var bytes = await _invoicingService.ExportCompanyInvoicesExcelAsync(monthYear, ct);
            var cleanMonth = (monthYear ?? "Month").Trim().ToUpperInvariant();
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Silmun_Invoice_{cleanMonth}.xlsx");
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "ExportExcel error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Calculate company invoices for a billing cycle from profile invoicing source data.
    /// Recalculation safety guard: only unposted records are replaced if ReplaceExisting is true.
    /// </summary>
    [HttpPost("calculate")]
    [ProducesResponseType(typeof(CalculateCompanyInvoicesResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> CalculateInvoices([FromBody] CalculateCompanyInvoicesRequest request, CancellationToken ct)
    {
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "system";
            var result = await _invoicingService.CalculateCompanyInvoicesAsync(request, username, ct);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message, message = ex.Message });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "CalculateCompanyInvoices error for {MonthYear}: {Msg}", request.MonthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Post all unposted company invoices for the given month, marking them with Status 'P' and timestamps.
    /// </summary>
    [HttpPost("post")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> PostInvoices([FromQuery] string monthYear, [FromQuery] bool replaceExisting = false, CancellationToken ct = default)
    {
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "system";
            var success = await _invoicingService.PostCompanyInvoicesAsync(monthYear, replaceExisting, username, ct);
            return Ok(new { success, monthYear, posted = success });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message, message = ex.Message });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "PostCompanyInvoices error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }
}

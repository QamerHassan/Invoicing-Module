using System;
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
[Route("api/dashboard")]
[Tags("Dashboard")]
[Authorize]
public class DashboardController : ControllerBase
{
    private readonly IInvoicingService _invoicingService;

    public DashboardController(IInvoicingService invoicingService)
    {
        _invoicingService = invoicingService;
    }

    /// <summary>
    /// Retrieve aggregated executive dashboard KPIs, monthly trends, and top vendor metrics.
    /// Optionally filtered by billing month (e.g. OCT26, SEP26).
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(DashboardSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetDashboard([FromQuery] string? month, CancellationToken ct)
    {
        try
        {
            var summary = await _invoicingService.GetDashboardSummaryAsync(month, ct);
            return Ok(summary);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Dashboard error");
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Get all available billing months across company, profile, and final invoicing.
    /// Returns sorted latest first (e.g. OCT26, SEP26, MAY26, APR26).
    /// </summary>
    [HttpGet("billing-months")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(System.Collections.Generic.List<string>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetBillingMonths(CancellationToken ct)
    {
        var months = await _invoicingService.GetAvailableBillingMonthsAsync(ct);
        return Ok(months);
    }
}

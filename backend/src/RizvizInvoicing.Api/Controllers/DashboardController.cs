using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
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
    private readonly IMemoryCache _cache;

    public DashboardController(IInvoicingService invoicingService, IMemoryCache cache)
    {
        _invoicingService = invoicingService;
        _cache = cache;
    }

    /// <summary>
    /// Retrieve aggregated executive dashboard KPIs, monthly trends, and top vendor metrics.
    /// Optionally filtered by billing month (e.g. OCT26, SEP26). Cached for 2 minutes.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(DashboardSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetDashboard([FromQuery] string? month, CancellationToken ct)
    {
        try
        {
            var cleanMonth = month?.Trim().Replace("-", "").ToUpperInvariant() ?? "all";
            var cacheKey = $"dashboard_{cleanMonth}";

            if (!_cache.TryGetValue(cacheKey, out DashboardSummaryDto? summary))
            {
                summary = await _invoicingService.GetDashboardSummaryAsync(month, ct);
                _cache.Set(cacheKey, summary, new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2),
                    Size = 1
                });
            }

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
    /// Returns sorted latest first (e.g. OCT26, SEP26, MAY26, APR26). Cached for 5 minutes.
    /// </summary>
    [HttpGet("billing-months")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(System.Collections.Generic.List<string>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetBillingMonths(CancellationToken ct)
    {
        const string cacheKey = "dashboard_billing_months";
        if (!_cache.TryGetValue(cacheKey, out object? months))
        {
            months = await _invoicingService.GetAvailableBillingMonthsAsync(ct);
            _cache.Set(cacheKey, months, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                Size = 1
            });
        }
        return Ok(months);
    }
}

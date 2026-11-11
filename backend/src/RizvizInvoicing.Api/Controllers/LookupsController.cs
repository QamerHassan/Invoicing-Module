using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/lookups")]
[Tags("Lookups")]
[Authorize]
public class LookupsController : ControllerBase
{
    private readonly InvoicingDbContext _db;
    private readonly IMemoryCache _cache;

    public LookupsController(InvoicingDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    /// <summary>Retrieve active vendors from setups.vendors.</summary>
    [HttpGet("vendors")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetVendors(CancellationToken ct)
    {
        const string key = "lookups_vendors";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.Vendors.AsNoTracking()
                .Where(v => v.Active == "Y")
                .OrderBy(v => v.VendName)
                .Select(v => new { v.VendCode, v.VendName, v.Shortcode })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>Retrieve active profile owners from prof.Profile_Owners.</summary>
    [HttpGet("profile-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProfileOwners(CancellationToken ct)
    {
        const string key = "lookups_profile_owners";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.ProfileOwners.AsNoTracking()
                .Where(p => (p.Active == null || p.Active != "N") && p.ProfileName != null && p.ProfileName != "")
                .OrderBy(p => p.ProfileName)
                .Select(p => new { p.PrfOwnCode, p.ProfileName, p.ProfileType, p.IsProfgrpOwner })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>Retrieve profile group owners from prof.Profile_Owners.</summary>
    [HttpGet("profile-group-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProfileGroupOwners(CancellationToken ct)
    {
        const string key = "lookups_profile_group_owners";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.ProfileOwners.AsNoTracking()
                .Where(p => (p.Active == null || p.Active != "N") && p.ProfileName != null && p.ProfileName != "")
                .OrderBy(p => p.ProfileName)
                .Select(p => new { p.PrfOwnCode, p.ProfileName, p.ProfileType, p.IsProfgrpOwner })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>Retrieve active currency exchange rates from setups.exchange_rate.</summary>
    [HttpGet("exchange-rates")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetExchangeRates(CancellationToken ct)
    {
        const string key = "lookups_exchange_rates";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.ExchangeRates.AsNoTracking()
                .Where(e => e.Active == "Y")
                .OrderByDescending(e => e.EffectiveFrom)
                .Select(e => new { ExchangeRateCode = e.ExchangeRateCodeCode, e.Rate, e.EffectiveFrom })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>Retrieve HRMS employee entities from hrms.entity.</summary>
    [HttpGet("entities")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetEntities(CancellationToken ct)
    {
        const string key = "lookups_entities";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.HrmsEntities.AsNoTracking()
                .OrderBy(e => e.FullName)
                .Select(e => new { e.EntityCode, e.FullName, e.Shortcode })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>Retrieve marketing projects from mkt.Projects.</summary>
    [HttpGet("projects")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProjects(CancellationToken ct)
    {
        const string key = "lookups_projects";
        if (!_cache.TryGetValue(key, out object? cached))
        {
            cached = await _db.MktProjects.AsNoTracking()
                .OrderBy(p => p.ProjName)
                .Select(p => new { p.ProjectCode, p.ProjName, p.ProjStatus, p.BranchCode, IsForeign = (p.BranchCode == 5) })
                .ToListAsync(ct);
            _cache.Set(key, cached, new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30), Size = 1 });
        }
        return Ok(cached);
    }

    /// <summary>
    /// Returns DISTINCT profile group owners who have at least one row in dbo.Profile_invoicing.
    /// Optionally filtered by invoice_month. Used to populate the owner dropdown in Excel View.
    /// </summary>
    [HttpGet("posted-group-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPostedGroupOwners([FromQuery] string? month, CancellationToken ct)
    {
        string? cleanMonth = string.IsNullOrWhiteSpace(month) ? null
            : month.Trim().ToUpperInvariant().Replace("-", "");

        string cacheKey = $"posted_group_owners_{cleanMonth ?? "all"}";
        if (_cache.TryGetValue(cacheKey, out object? cached))
            return Ok(cached);

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        var results = new List<object>();
        using var cmd = conn.CreateCommand();

        if (string.IsNullOrEmpty(cleanMonth))
        {
            cmd.CommandText = @"
                SELECT DISTINCT pi.prfgrp_own_code,
                       ISNULL(po.profile_name, CAST(pi.prfgrp_own_code AS NVARCHAR(20))) AS profile_name
                FROM dbo.Profile_invoicing pi
                LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfgrp_own_code
                WHERE pi.prfgrp_own_code IS NOT NULL AND pi.prfgrp_own_code > 0
                ORDER BY profile_name";
        }
        else
        {
            cmd.CommandText = @"
                SELECT DISTINCT pi.prfgrp_own_code,
                       ISNULL(po.profile_name, CAST(pi.prfgrp_own_code AS NVARCHAR(20))) AS profile_name
                FROM dbo.Profile_invoicing pi
                LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfgrp_own_code
                WHERE pi.prfgrp_own_code IS NOT NULL AND pi.prfgrp_own_code > 0
                  AND REPLACE(RTRIM(pi.invoice_month), '-', '') = @month
                ORDER BY profile_name";
            var p = cmd.CreateParameter();
            p.ParameterName = "@month";
            p.Value = cleanMonth;
            cmd.Parameters.Add(p);
        }

        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            results.Add(new
            {
                prfOwnCode = reader.GetInt32(0),
                profileName = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim()
            });
        }

        _cache.Set(cacheKey, (object)results, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
            Size = 1
        });

        return Ok(results);
    }
}

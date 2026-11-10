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
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/lookups")]
[Tags("Lookups")]
[Authorize]
public class LookupsController : ControllerBase
{
    private readonly InvoicingDbContext _db;

    public LookupsController(InvoicingDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Retrieve active vendors from setups.vendors.
    /// </summary>
    [HttpGet("vendors")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetVendors(CancellationToken ct)
    {
        var vendors = await _db.Vendors.AsNoTracking()
            .Where(v => v.Active == "Y")
            .OrderBy(v => v.VendName)
            .Select(v => new { v.VendCode, v.VendName, v.Shortcode })
            .ToListAsync(ct);
        return Ok(vendors);
    }

    /// <summary>
    /// Retrieve active profile owners from prof.Profile_Owners.
    /// Returns all distinct active profile owners sorted alphabetically by ProfileName.
    /// Does not restrict by is_profgrp_owner or EmpStatus_Code, ensuring all owners are selectable.
    /// </summary>
    [HttpGet("profile-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProfileOwners(CancellationToken ct)
    {
        var owners = await _db.ProfileOwners.AsNoTracking()
            .Where(p => (p.Active == null || p.Active != "N") && p.ProfileName != null && p.ProfileName != "")
            .OrderBy(p => p.ProfileName)
            .Select(p => new { p.PrfOwnCode, p.ProfileName, p.ProfileType, p.IsProfgrpOwner })
            .ToListAsync(ct);
        return Ok(owners);
    }

    /// <summary>
    /// Retrieve profile group owners from prof.Profile_Owners.
    /// Returns all active profile owners sorted alphabetically by ProfileName for dropdown selection.
    /// </summary>
    [HttpGet("profile-group-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProfileGroupOwners(CancellationToken ct)
    {
        var groupOwners = await _db.ProfileOwners.AsNoTracking()
            .Where(p => (p.Active == null || p.Active != "N") && p.ProfileName != null && p.ProfileName != "")
            .OrderBy(p => p.ProfileName)
            .Select(p => new { p.PrfOwnCode, p.ProfileName, p.ProfileType, p.IsProfgrpOwner })
            .ToListAsync(ct);
        return Ok(groupOwners);
    }

    /// <summary>
    /// Retrieve active currency exchange rates from setups.exchange_rate.
    /// </summary>
    [HttpGet("exchange-rates")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetExchangeRates(CancellationToken ct)
    {
        var rates = await _db.ExchangeRates.AsNoTracking()
            .Where(e => e.Active == "Y")
            .OrderByDescending(e => e.EffectiveFrom)
            .Select(e => new { ExchangeRateCode = e.ExchangeRateCodeCode, e.Rate, e.EffectiveFrom })
            .ToListAsync(ct);
        return Ok(rates);
    }

    /// <summary>
    /// Retrieve HRMS employee entities from hrms.entity.
    /// </summary>
    [HttpGet("entities")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetEntities(CancellationToken ct)
    {
        var entities = await _db.HrmsEntities.AsNoTracking()
            .OrderBy(e => e.FullName)
            .Select(e => new { e.EntityCode, e.FullName, e.Shortcode })
            .ToListAsync(ct);
        return Ok(entities);
    }

    /// <summary>
    /// Retrieve marketing projects from mkt.Projects.
    /// </summary>
    [HttpGet("projects")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetProjects(CancellationToken ct)
    {
        var projects = await _db.MktProjects.AsNoTracking()
            .OrderBy(p => p.ProjName)
            .Select(p => new { p.ProjectCode, p.ProjName, p.ProjStatus, p.BranchCode, IsForeign = (p.BranchCode == 5) })
            .ToListAsync(ct);
        return Ok(projects);
    }

    /// <summary>
    /// Returns DISTINCT profile group owners who have at least one row in dbo.Profile_invoicing.
    /// Optionally filtered by invoice_month (accepts SEP26 or SEP-26 format). 
    /// Used to populate the owner dropdown in Excel View and Invoice Detail (Processed) tabs.
    /// Always fresh from DB — no cache.
    /// </summary>
    [HttpGet("posted-group-owners")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPostedGroupOwners([FromQuery] string? month, CancellationToken ct)
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";

        // Normalise month: strip hyphen, upper case  (SEP-26 → SEP26)
        string? cleanMonth = null;
        if (!string.IsNullOrWhiteSpace(month))
            cleanMonth = month.Trim().ToUpperInvariant().Replace("-", "");

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
                LEFT JOIN prof.Profile_Owners po
                       ON po.PrfOwn_code = pi.prfgrp_own_code
                WHERE pi.prfgrp_own_code IS NOT NULL
                  AND pi.prfgrp_own_code > 0
                ORDER BY profile_name";
        }
        else
        {
            cmd.CommandText = @"
                SELECT DISTINCT pi.prfgrp_own_code,
                       ISNULL(po.profile_name, CAST(pi.prfgrp_own_code AS NVARCHAR(20))) AS profile_name
                FROM dbo.Profile_invoicing pi
                LEFT JOIN prof.Profile_Owners po
                       ON po.PrfOwn_code = pi.prfgrp_own_code
                WHERE pi.prfgrp_own_code IS NOT NULL
                  AND pi.prfgrp_own_code > 0
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

        return Ok(results);
    }
}

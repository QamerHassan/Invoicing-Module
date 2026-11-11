using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Domain.Entities;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Infrastructure.Services;

public class InvoicingService : IInvoicingService
{
    private readonly InvoicingDbContext _context;
    private readonly INumberSequenceService _seq;

    public InvoicingService(InvoicingDbContext context, INumberSequenceService seq)
    {
        _context = context;
        _seq = seq;
    }

    private DbCommand CreateDbCommand(DbConnection conn)
    {
        var cmd = conn.CreateCommand();
        var currentTx = _context.Database.CurrentTransaction?.GetDbTransaction();
        if (currentTx != null)
        {
            cmd.Transaction = currentTx;
        }
        return cmd;
    }

    // ── Static In-Memory Cache for Lookups (Eliminates RDS latency) ───────────
    private static DateTime _cacheExpiry = DateTime.MinValue;
    private static Dictionary<int, string>? _cachedVendors;
    private static Dictionary<int, string>? _cachedProfiles;
    private static Dictionary<int, string>? _cachedProjects;
    private static Dictionary<int, int>? _cachedBranches;
    private static Dictionary<int, string>? _cachedProjectStacks;
    private static Dictionary<int, string>? _cachedChargibility;
    private static Dictionary<decimal, string>? _cachedEntities;
    private static Dictionary<decimal, string>? _cachedEntityStacks;
    private static Dictionary<string, string>? _cachedServiceHeads;
    private static readonly SemaphoreSlim _cacheLock = new SemaphoreSlim(1, 1);

    private async Task EnsureLookupsCachedAsync(CancellationToken ct)
    {
        if (_cacheExpiry > DateTime.UtcNow && _cachedVendors != null)
            return;

        await _cacheLock.WaitAsync(ct);
        try
        {
            if (_cacheExpiry > DateTime.UtcNow && _cachedVendors != null)
                return;

            _cachedVendors       = await GetVendorNamesAsync(ct);
            _cachedProfiles      = await GetProfileOwnerNamesAsync(ct);
            _cachedProjects      = await GetProjectNamesAsync(ct);
            _cachedBranches      = await GetProjectBranchesAsync(ct);
            _cachedProjectStacks = await GetProjectStacksAsync(ct);
            _cachedChargibility  = await GetChargibilityNamesAsync(ct);
            _cachedEntities      = await GetEntityNamesAsync(ct);
            _cachedEntityStacks  = await GetEntityStacksAsync(ct);
            _cachedServiceHeads  = await GetServiceHeadNamesAsync(ct);

            _cacheExpiry = DateTime.UtcNow.AddMinutes(15);
        }
        finally
        {
            _cacheLock.Release();
        }
    }

    // ── Lookups ─────────────────────────────────────────────────────────────

    private async Task<Dictionary<int, string>> GetVendorNamesAsync(CancellationToken ct)
        => await _context.Vendors.AsNoTracking()
            .Select(v => new { v.VendCode, Name = v.VendName ?? "" })
            .ToDictionaryAsync(v => v.VendCode, v => v.Name, ct);

    private async Task<Dictionary<int, string>> GetProfileOwnerNamesAsync(CancellationToken ct)
        => await _context.ProfileOwners.AsNoTracking()
            .Select(p => new { p.PrfOwnCode, Name = p.ProfileName ?? "" })
            .ToDictionaryAsync(p => p.PrfOwnCode, p => p.Name, ct);

    private async Task<Dictionary<int, string>> GetProjectNamesAsync(CancellationToken ct)
        => await _context.MktProjects.AsNoTracking()
            .Select(p => new { p.ProjectCode, Name = p.ProjName ?? "" })
            .ToDictionaryAsync(p => p.ProjectCode, p => p.Name, ct);

    private async Task<Dictionary<int, int>> GetProjectBranchesAsync(CancellationToken ct)
        => await _context.MktProjects.AsNoTracking()
            .Select(p => new { p.ProjectCode, Branch = p.BranchCode ?? 0 })
            .ToDictionaryAsync(p => p.ProjectCode, p => p.Branch, ct);

    private async Task<Dictionary<int, string>> GetProjectStacksAsync(CancellationToken ct)
    {
        var list = await (
            from p in _context.MktProjects.AsNoTracking()
            join s in _context.SetupStacks.AsNoTracking() on p.StackCde equals s.StackCode
            where p.StackCde != null && s.StackName != null
            select new { p.ProjectCode, StackName = s.StackName.Trim() }
        ).ToListAsync(ct);

        return list
            .GroupBy(x => x.ProjectCode)
            .ToDictionary(g => g.Key, g => g.First().StackName);
    }

    private async Task<Dictionary<int, string>> GetChargibilityNamesAsync(CancellationToken ct)
    {
        var dict = new Dictionary<int, string>();
        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        using var cmd = CreateDbCommand(conn);
        cmd.CommandText = "SELECT DISTINCT charg_type_code, resource_nature FROM setups.Chargibility WHERE charg_type_code IS NOT NULL AND resource_nature IS NOT NULL";
        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var code = reader.GetInt32(0);
            var nature = reader.GetString(1).Trim();
            if (!dict.ContainsKey(code))
                dict[code] = nature;
        }
        return dict;
    }

    private async Task<Dictionary<decimal, string>> GetEntityNamesAsync(CancellationToken ct)
        => await _context.HrmsEntities.AsNoTracking()
            .Select(e => new { e.EntityCode, Name = e.FullName ?? "" })
            .ToDictionaryAsync(e => e.EntityCode, e => e.Name, ct);

    private async Task<Dictionary<decimal, string>> GetEntityStacksAsync(CancellationToken ct)
    {
        var list = await (
            from et in _context.EntityTeamstructures.AsNoTracking()
            join s in _context.SetupStacks.AsNoTracking() on et.StackCode equals s.StackCode
            where et.StackCode != null && s.StackName != null
            select new { et.EntityCode, StackName = s.StackName != null ? s.StackName.Trim() : "" }
        ).ToListAsync(ct);

        return list
            .GroupBy(x => x.EntityCode)
            .ToDictionary(g => g.Key, g => g.First().StackName);
    }

    private async Task<Dictionary<string, string>> GetServiceHeadNamesAsync(CancellationToken ct)
    {
        var list = await _context.EmpRoles.AsNoTracking()
            .Where(r => r.Shortcode != null && r.Description != null)
            .Select(r => new { Shortcode = r.Shortcode!.Trim(), Description = r.Description!.Trim() })
            .ToListAsync(ct);

        var dict = list
            .GroupBy(r => r.Shortcode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Description, StringComparer.OrdinalIgnoreCase);

        var fallbacks = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["OE"] = "Operating Expense",
            ["BO"] = "Bonus",
            ["BS"] = "Basic Salary",
            ["B"]  = "BD Commission (OT)",
            ["E"]  = "BD Commission (EXE)",
            ["X"]  = "Dev Commission",
            ["R"]  = "BD Commission (REG)",
            ["IT"] = "Technical / Recruiter",
            ["I"]  = "Interview 1st Commission",
            ["J"]  = "Interview 2nd Commission",
            ["TZ"] = "TimeZone Allowance",
            ["BD"] = "Business Development",
            ["BR"] = "Basic Resource",
            ["ST"] = "Stipend",
            ["OJ"] = "On-Job Support",
            ["EXP"] = "Expense",
            ["INV"] = "Inventory",
            ["PRF"] = "Profile Holder",
            ["TZA"] = "TimeZone Allowance",
            ["BON"] = "Bonus",
            ["DED"] = "Deduction",
            ["COM"] = "Commission",
            ["IC1"] = "1st Commission",
            ["IC2"] = "2nd Commission",
            ["OTI"] = "Other Increments",
            ["JOB"] = "Job Holder",
            ["SPO"] = "Support to Others",
            ["SDR"] = "2nd Resource",
            ["SPC"] = "Special",
            ["ESP"] = "External Support",
            ["ADC"] = "Additional Charges",
            ["SCR"] = "Self Closer Recurring",
            ["OCR"] = "Other Closer Recurring"
        };

        foreach (var kvp in fallbacks)
        {
            if (!dict.ContainsKey(kvp.Key))
            {
                dict[kvp.Key] = kvp.Value;
            }
        }

        return dict;
    }

    // ── Company Invoicing ────────────────────────────────────────────────────

    public async Task<List<CompanyInvoiceDto>> GetCompanyInvoicesAsync(
        string monthYear, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();

        // Ensure lookups are cached in memory (0ms on cache hit)
        await EnsureLookupsCachedAsync(ct);

        var vendors         = _cachedVendors ?? new();
        var profiles        = _cachedProfiles ?? new();
        var projects        = _cachedProjects ?? new();
        var entities        = _cachedEntities ?? new();
        var stacks          = _cachedEntityStacks ?? new();
        var projectStacks   = _cachedProjectStacks ?? new();
        var serviceHeads    = _cachedServiceHeads ?? new();
        var chargibilities  = _cachedChargibility ?? new();
        var projectBranches = _cachedBranches ?? new();

        var rows = await _context.CompanyInvoices.AsNoTracking()
            .Where(c => c.InvoiceMonth != null && c.InvoiceMonth.Trim().Replace("-", "") == cleanMonth)
            .OrderBy(c => c.CmpInvoiceSeqCode)
            .ToListAsync(ct);

        var mktRows = await _context.MktProjectInvoices.AsNoTracking()
            .Where(m => m.MonthYear != null && m.MonthYear.Trim().Replace("-", "") == cleanMonth)
            .ToListAsync(ct);

        var mktDict = mktRows
            .Where(m => m.EntityCode.HasValue && m.ProjectCode.HasValue && m.InvoiceTo.HasValue)
            .GroupBy(m => (m.EntityCode!.Value, m.ProjectCode!.Value, m.InvoiceTo!.Value))
            .ToDictionary(g => g.Key, g => g.First());

        return rows.Select(c => MapCompany(c, vendors, profiles, projects, entities, stacks, mktDict, serviceHeads, projectBranches, projectStacks, chargibilities)).ToList();
    }

    public async Task<List<ProfileProjectDto>> GetProfileProjectsAsync(int? profileOwnerId = null, CancellationToken ct = default)
    {
        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        var list = new List<ProfileProjectDto>();
        using (var cmd = CreateDbCommand(conn))
        {
            var sql = @"
                SELECT DISTINCT 
                    p.prfown_code,
                    p.profile_name AS profile_owner,
                    sup.project_code,
                    pr.Proj_name AS project_name,
                    pr.proj_status,					    
                    e.full_name AS developer_name,
                    e.shortcode
                FROM prof.Profile_Owners p
                INNER JOIN mkt.interview_master im ON im.PrfOwn_code = p.PrfOwn_code
                INNER JOIN mkt.Projects pr ON pr.interview_code = im.interview_code
                INNER JOIN mkt.project_support sup ON sup.project_code = pr.project_Code
                INNER JOIN hrms.entity e ON e.entity_code = sup.entity_code
                WHERE pr.proj_status IS NOT NULL
                  AND sup.resource_type = 'JH'
                  AND (
                    pr.proj_status <> 'Closed'
                    OR (
                        pr.proj_status = 'Closed'
                        AND pr.proj_close_dte >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
                        AND pr.proj_close_dte < DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
                    )
                  )";

            if (profileOwnerId.HasValue && profileOwnerId.Value > 0)
            {
                sql += " AND p.prfown_code = @owner";
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = profileOwnerId.Value;
                cmd.Parameters.Add(pOwner);
            }

            sql += " ORDER BY p.profile_name, pr.Proj_name";
            cmd.CommandText = sql;

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                list.Add(new ProfileProjectDto(
                    PrfownCode: reader.GetInt32(0),
                    ProfileOwner: reader.IsDBNull(1) ? string.Empty : reader.GetString(1).Trim(),
                    ProjectCode: reader.GetInt32(2),
                    ProjectName: reader.IsDBNull(3) ? string.Empty : reader.GetString(3).Trim(),
                    ProjStatus: reader.IsDBNull(4) ? string.Empty : reader.GetString(4).Trim(),
                    DeveloperName: reader.IsDBNull(5) ? string.Empty : reader.GetString(5).Trim(),
                    Shortcode: reader.IsDBNull(6) ? null : reader.GetString(6).Trim()
                ));
            }
        }
        return list;
    }

    public async Task<CalculateCompanyInvoicesResponse> CalculateCompanyInvoicesAsync(
        CalculateCompanyInvoicesRequest request, string username, CancellationToken ct = default)
    {
        var rawMonth = request.MonthYear ?? string.Empty;
        var cleanMonth = rawMonth.Trim().Replace("-", "").ToUpperInvariant();
        bool isSingle = string.Equals(request.Mode, "Single", StringComparison.OrdinalIgnoreCase) &&
                        request.ProfileOwnerId.HasValue && request.ProfileOwnerId.Value > 0;

        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        // Check if records already exist for this month in company_invoicing
        int existingCount = 0;
        using (var cmd = CreateDbCommand(conn))
        {
            var countSql = "SELECT COUNT(*) FROM dbo.company_invoicing WHERE REPLACE(RTRIM(invoice_month), '-', '') = @m";
            if (isSingle)
                countSql += " AND prfown_code = @owner";

            cmd.CommandText = countSql;
            var param = cmd.CreateParameter();
            param.ParameterName = "@m";
            param.Value = cleanMonth;
            cmd.Parameters.Add(param);

            if (isSingle)
            {
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = request.ProfileOwnerId!.Value;
                cmd.Parameters.Add(pOwner);
            }

            var obj = await cmd.ExecuteScalarAsync(ct);
            existingCount = Convert.ToInt32(obj);
        }

        // PB behavior: If records already exist and replaceExisting is FALSE, return existing invoices.
        if (existingCount > 0 && !request.ReplaceExisting)
        {
            var existingDtos = await GetCompanyInvoicesAsync(cleanMonth, ct);
            if (isSingle)
                existingDtos = existingDtos.Where(d => d.PrfownCode == request.ProfileOwnerId!.Value).ToList();

            return new CalculateCompanyInvoicesResponse(
                MonthYear: cleanMonth,
                TotalRows: existingDtos.Count,
                TotalChargedUsd: existingDtos.Sum(d => d.ChargedAmtUsd ?? 0),
                TotalSilmunUsd: existingDtos.Where(d => d.InvoiceTo == 1).Sum(d => d.FinalUsd ?? d.ChargedAmtUsd ?? 0),
                TotalPaidExpCostUsd: existingDtos.Where(d => d.InvoiceTo == 2).Sum(d => d.UsdCost ?? 0),
                TotalPaidExpShareUsd: existingDtos.Where(d => d.InvoiceTo == 2).Sum(d => d.TotalReceivableAmount ?? 0),
                Rows: existingDtos
            );
        }

        // If replaceExisting (or fresh calculation), delete old invoices for this month (matching PB uf_save_invoicing)
        if (existingCount > 0 && request.ReplaceExisting)
        {
            using (var cmd = CreateDbCommand(conn))
            {
                var delSql = "DELETE FROM dbo.company_invoicing WHERE REPLACE(RTRIM(invoice_month), '-', '') = @m";
                if (isSingle)
                    delSql += " AND prfown_code = @owner";

                cmd.CommandText = delSql;
                var param = cmd.CreateParameter();
                param.ParameterName = "@m";
                param.Value = cleanMonth;
                cmd.Parameters.Add(param);

                if (isSingle)
                {
                    var pOwner = cmd.CreateParameter();
                    pOwner.ParameterName = "@owner";
                    pOwner.Value = request.ProfileOwnerId!.Value;
                    cmd.Parameters.Add(pOwner);
                }

                await cmd.ExecuteNonQueryAsync(ct);
            }
        }

        // Pull active exchange rate matching PB:
        // SELECT TOP 1 rate FROM setups.exchange_rate ORDER BY ExchangeRateCode_code ASC
        var exchangeRate = await _context.ExchangeRates.AsNoTracking()
            .OrderBy(e => e.ExchangeRateCodeCode)
            .FirstOrDefaultAsync(ct);
        decimal activeRate = exchangeRate?.Rate ?? 276m;

        // PB STEP 1: uf_bulk_processing / uf_calc_single_invoice - Pull distinct projects and rows from mkt.project_invoicing
        var newRows = new List<CompanyInvoicing>();

        using (var cmd = CreateDbCommand(conn))
        {
            var pSql = @"
                SELECT 
                    p.project_code,
                    COALESCE(im.prfown_code, 0) AS prfown_code,
                    p.entity_code,
                    p.resource_type,
                    COALESCE(p.paid_amount, 0) AS total_income_pkr,
                    p.secondary_dev_code,
                    COALESCE(p.invoice_to, 0) AS invoice_to,
                    p.job_ccy AS ccy,
                    p.exch_rate,
                    COALESCE(p.total_sal_usd, 0) AS total_usd_cost,
                    COALESCE(p.rizviz_charges, 0) AS share_amount,
                    COALESCE(p.total_usd_charges, 0) AS charged_amt_usd,
                    p.month_year,
                    p.charg_type_code,
                    p.interview_code,
                    p.support_status,
                    p.month_days,
                    p.pro_rate_days
                FROM mkt.project_invoicing p
                LEFT JOIN mkt.projects prj ON prj.project_code = p.project_code
                LEFT JOIN mkt.interview_master im ON im.interview_code = prj.interview_code
                WHERE REPLACE(RTRIM(p.month_year), '-', '') = @m
                  AND p.entity_code IS NOT NULL AND p.entity_code > 0";

            if (isSingle)
                pSql += " AND im.prfown_code = @owner";

            cmd.CommandText = pSql;
            var param = cmd.CreateParameter();
            param.ParameterName = "@m";
            param.Value = cleanMonth;
            cmd.Parameters.Add(param);

            if (isSingle)
            {
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = request.ProfileOwnerId!.Value;
                cmd.Parameters.Add(pOwner);
            }

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int? projectCode = reader.IsDBNull(0) ? null : reader.GetInt32(0);
                int? prfownCode = reader.IsDBNull(1) ? null : reader.GetInt32(1);
                decimal? entityCode = reader.IsDBNull(2) ? null : reader.GetDecimal(2);
                string? resourceType = reader.IsDBNull(3) ? null : reader.GetString(3);
                decimal paidAmt = reader.IsDBNull(4) ? 0m : reader.GetDecimal(4);
                int? secondaryDevCode = reader.IsDBNull(5) ? null : (int?)Convert.ToInt32(reader.GetValue(5));
                int invoiceTo = reader.IsDBNull(6) ? 0 : reader.GetInt32(6);
                int? ccy = reader.IsDBNull(7) ? null : reader.GetInt32(7);
                decimal exchRate = reader.IsDBNull(8) ? activeRate : reader.GetDecimal(8);
                int totalUsdCost = reader.IsDBNull(9) ? 0 : (int)Math.Round(reader.GetDecimal(9), MidpointRounding.AwayFromZero);
                decimal shareAmt = reader.IsDBNull(10) ? 0m : reader.GetDecimal(10);
                decimal chargedAmtUsd = reader.IsDBNull(11) ? 0m : reader.GetDecimal(11);
                string? rowMonthYear = reader.IsDBNull(12) ? null : reader.GetString(12);
                int? chargTypeCode = reader.IsDBNull(13) ? null : reader.GetInt32(13);
                int? interviewCode = reader.IsDBNull(14) ? null : reader.GetInt32(14);
                string? supportStatus = reader.IsDBNull(15) ? null : reader.GetString(15);
                int? monthDays = reader.IsDBNull(16) ? null : reader.GetInt32(16);
                int? proRateDays = reader.IsDBNull(17) ? null : reader.GetInt32(17);

                // PB uf_bulk_processing Find or insert check:
                // entity_code = X AND charg_type_code = Y AND project_code = Z AND Upper(Trim(month_year)) = M
                // optional: support_status, secondary_dev_code
                var existing = newRows.FirstOrDefault(r =>
                    r.EntityCode == entityCode &&
                    r.ChargTypeCode == chargTypeCode &&
                    r.ProjectCode == projectCode &&
                    string.Equals(r.InvoiceMonth?.Trim(), cleanMonth, StringComparison.OrdinalIgnoreCase) &&
                    (string.IsNullOrEmpty(supportStatus?.Trim()) || string.Equals(r.SupportStatus?.Trim(), supportStatus?.Trim(), StringComparison.OrdinalIgnoreCase)) &&
                    (!secondaryDevCode.HasValue || secondaryDevCode.Value <= 0 || r.SecondaryDevCode == secondaryDevCode)
                );

                if (existing != null)
                {
                    existing.EntityCode = entityCode;
                    existing.PrfownCode = prfownCode;
                    existing.ResourceType = resourceType;
                    existing.TotalIncomePkr = paidAmt;
                    existing.TotalUsdCost = totalUsdCost;
                    existing.ShareAmount = shareAmt;
                    existing.ExchangeRate = exchRate;
                    existing.ChargedAmtUsd = chargedAmtUsd;
                    existing.ProjectCode = projectCode;
                    existing.SecondaryDevCode = secondaryDevCode;
                    existing.InvoiceTo = invoiceTo;
                    existing.InvoiceMonth = cleanMonth;
                    existing.Ccy = ccy;
                    existing.SupportStatus = supportStatus;
                    existing.ChargTypeCode = chargTypeCode;
                    existing.InterviewCode = interviewCode;
                    existing.MonthDays = monthDays;
                    existing.ProRateDays = proRateDays;
                }
                else
                {
                    newRows.Add(new CompanyInvoicing
                    {
                        ProjectCode = projectCode,
                        PrfownCode = prfownCode,
                        EntityCode = entityCode,
                        ResourceType = resourceType,
                        TotalIncomePkr = paidAmt,
                        SecondaryDevCode = secondaryDevCode,
                        InvoiceTo = invoiceTo,
                        Ccy = ccy,
                        ExchangeRate = exchRate,
                        TotalUsdCost = totalUsdCost,
                        ShareAmount = shareAmt,
                        ChargedAmtUsd = chargedAmtUsd,
                        InvoiceMonth = cleanMonth,
                        ChargTypeCode = chargTypeCode,
                        InterviewCode = interviewCode,
                        SupportStatus = supportStatus,
                        MonthDays = monthDays,
                        ProRateDays = proRateDays,
                        InsertBy = username,
                        InsertTime = DateTime.UtcNow,
                        Status = null
                    });
                }
            }
        }

        // PB STEP 2A: uf_terms_condition - Other Incomes (dw_other_incomes from HRMSALARY.Others_incomes)
        if (!isSingle)
        {
            using (var cmd = CreateDbCommand(conn))
            {
                var oiSql = @"
                    SELECT 
                        oi.Entity_code,
                        oi.charg_type_code,
                        COALESCE(oi.Amount, 0) AS amount,
                        COALESCE(oi.ccy, 1) AS ccy,
                        COALESCE(oi.invoice_to, 1) AS invoice_to
                    FROM HRMSALARY.Others_incomes oi
                    WHERE REPLACE(RTRIM(oi.Month_Year), '-', '') = @m
                      AND oi.invoice_to IN (1, 2)";

                cmd.CommandText = oiSql;
                var param = cmd.CreateParameter();
                param.ParameterName = "@m";
                param.Value = cleanMonth;
                cmd.Parameters.Add(param);

                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var ent = reader.GetDecimal(0);
                    var charg = reader.GetInt32(1);
                    var amount = reader.GetDecimal(2);
                    var ccy = reader.GetInt32(3);
                    var invTo = reader.GetInt32(4);

                    decimal usdCharges;
                    if (ccy == 1)
                        usdCharges = activeRate > 0 ? Math.Round(amount / activeRate, 0, MidpointRounding.AwayFromZero) : amount;
                    else
                        usdCharges = amount;

                    // PB Find check: entity_code = X AND charg_type_code = Y
                    bool found = newRows.Any(r => r.EntityCode == ent && r.ChargTypeCode == charg);
                    if (!found)
                    {
                        newRows.Add(new CompanyInvoicing
                        {
                            EntityCode = ent,
                            PrfownCode = null,
                            ResourceType = "",
                            TotalIncomePkr = amount,
                            TotalUsdCost = (int)usdCharges,
                            ShareAmount = 0m,
                            ExchangeRate = activeRate,
                            ChargedAmtUsd = usdCharges,
                            ProjectCode = null,
                            SecondaryDevCode = null,
                            InvoiceTo = invTo,
                            InvoiceMonth = cleanMonth,
                            Ccy = ccy,
                            ChargTypeCode = charg,
                            InterviewCode = null,
                            InterviewSeqCode = null,
                            SupportStatus = null,
                            MonthDays = null,
                            ProRateDays = null,
                            InsertBy = username,
                            InsertTime = DateTime.UtcNow,
                            Status = null
                        });
                    }
                }
            }
        }

        // PB STEP 2B: uf_terms_condition - BD Share (charg_type_code = 47)
        string lsMonthAbbr = cleanMonth.Length >= 3 ? cleanMonth.Substring(0, 3) : cleanMonth;
        int llYear = 2026;
        if (cleanMonth.Length >= 5 && int.TryParse(cleanMonth.Substring(3, 2), out int parsedYr))
            llYear = 2000 + parsedYr;

        int llMonth = lsMonthAbbr.ToUpperInvariant() switch
        {
            "JAN" => 1,
            "FEB" => 2,
            "MAR" => 3,
            "APR" => 4,
            "MAY" => 5,
            "JUN" => 6,
            "JUL" => 7,
            "AUG" => 8,
            "SEP" => 9,
            "OCT" => 10,
            "NOV" => 11,
            "DEC" => 12,
            _ => DateTime.UtcNow.Month
        };

        var ldFirstDay = new DateTime(llYear, llMonth, 1);
        int llTotalMonthDays = DateTime.DaysInMonth(llYear, llMonth);
        var ldLastDay = new DateTime(llYear, llMonth, llTotalMonthDays);

        using (var cmd = CreateDbCommand(conn))
        {
            var bdSql = @"
                SELECT 
                    ec.entity_code,
                    ec.charg_type_code,
                    COALESCE(ec.Amount, 0) AS amount,
                    COALESCE(ec.currency_code, 1) AS currency_code,
                    COALESCE(ec.invoice_to, 1) AS invoice_to,
                    e.join_date,
                    e.termination_date,
                    COALESCE(e.gross_salary, 0) AS gross_salary,
                    e.ccy AS basic_ccy,
                    ec.prfown_code
                FROM hrms.emp_config ec
                LEFT JOIN hrms.entity e ON e.entity_code = ec.entity_code
                WHERE ec.charg_type_code = 47";

            if (isSingle)
                bdSql += " AND ec.prfown_code = @owner";

            bdSql += " ORDER BY ec.Empconfig_code ASC";

            cmd.CommandText = bdSql;
            if (isSingle)
            {
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = request.ProfileOwnerId!.Value;
                cmd.Parameters.Add(pOwner);
            }

            decimal lastTotUsdBasic = 0m;
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var ent = reader.GetDecimal(0);
                var charg = reader.GetInt32(1);
                var amount = reader.GetDecimal(2);
                var ccy = reader.GetInt32(3);
                var invTo = reader.GetInt32(4);
                DateTime? joinDt = reader.IsDBNull(5) ? null : reader.GetDateTime(5);
                DateTime? termDt = reader.IsDBNull(6) ? null : reader.GetDateTime(6);
                var grossSal = reader.GetDecimal(7);
                int? basicCcy = reader.IsDBNull(8) ? null : reader.GetInt32(8);
                int? prfCode = reader.IsDBNull(9) ? null : reader.GetInt32(9);

                // Skip if terminated before this processing month
                if (termDt.HasValue && termDt.Value.Date < ldFirstDay)
                    continue;

                var effectiveStart = ldFirstDay;
                var effectiveEnd = ldLastDay;

                if (joinDt.HasValue && joinDt.Value.Year == llYear && joinDt.Value.Month == llMonth)
                    effectiveStart = joinDt.Value.Date;

                if (termDt.HasValue && termDt.Value.Year == llYear && termDt.Value.Month == llMonth)
                    effectiveEnd = termDt.Value.Date;

                int proDays = (effectiveEnd - effectiveStart).Days + 1;
                decimal proAmount = Math.Round((amount / (decimal)llTotalMonthDays) * proDays, 2, MidpointRounding.AwayFromZero);
                decimal proGross = Math.Round((grossSal / (decimal)llTotalMonthDays) * proDays, 2, MidpointRounding.AwayFromZero);

                // PB uf_terms_condition variable retention: ld_total_usd_basic only updated when basicCcy == 1.
                // When basicCcy == 2 or NULL, PB retains the previous iteration's value (PowerBuilder IF/ELSEIF behavior).
                if (basicCcy == 1)
                    lastTotUsdBasic = activeRate > 0 ? Math.Round(proGross / activeRate, 0, MidpointRounding.AwayFromZero) : proGross;

                decimal totUsdBasic = lastTotUsdBasic;

                decimal rizShare;
                if (ccy == 1)
                    rizShare = activeRate > 0 ? Math.Round(proAmount / activeRate, 0, MidpointRounding.AwayFromZero) : proAmount;
                else
                    rizShare = proAmount;

                decimal totUsd = rizShare + totUsdBasic;

                // Find existing row in PB: entity_code = X AND charg_type_code = 47
                bool found = newRows.Any(r => r.EntityCode == ent && r.ChargTypeCode == 47);
                if (!found)
                {
                    newRows.Add(new CompanyInvoicing
                    {
                        EntityCode = ent,
                        PrfownCode = prfCode,
                        ResourceType = "BS",
                        TotalIncomePkr = proGross,
                        TotalUsdCost = (int)totUsdBasic,
                        ShareAmount = rizShare,
                        ExchangeRate = activeRate,
                        ChargedAmtUsd = totUsd,
                        ProjectCode = null,
                        SecondaryDevCode = null,
                        InvoiceTo = invTo,
                        InvoiceMonth = cleanMonth,
                        Ccy = basicCcy,
                        SupportStatus = null,
                        ChargTypeCode = 47,
                        InterviewCode = null,
                        InterviewSeqCode = null,
                        MonthDays = llTotalMonthDays,
                        ProRateDays = proDays,
                        InsertBy = username,
                        InsertTime = DateTime.UtcNow,
                        Status = null
                    });
                }
            }
        }

        // PB STEP 2C: uf_terms_condition - Interview invoicing (IT)
        using (var cmd = CreateDbCommand(conn))
        {
            var itSql = @"
                SELECT 
                    ii.entity_code,
                    ii.charg_type_code,
                    COALESCE(ii.paid_amount, 0) AS paid_amount,
                    COALESCE(ii.currency_code, 1) AS ccy,
                    COALESCE(ii.invoice_to, 1) AS invoice_to,
                    ii.interview_code,
                    ii.interview_seq_code,
                    im.prfown_code
                FROM mkt.interview_invoicing ii
                LEFT JOIN mkt.interview_master im ON im.interview_code = ii.interview_code
                WHERE REPLACE(RTRIM(ii.month_year), '-', '') = @m";

            if (isSingle)
                itSql += " AND im.prfown_code = @owner";

            cmd.CommandText = itSql;
            var param = cmd.CreateParameter();
            param.ParameterName = "@m";
            param.Value = cleanMonth;
            cmd.Parameters.Add(param);

            if (isSingle)
            {
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = request.ProfileOwnerId!.Value;
                cmd.Parameters.Add(pOwner);
            }

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var ent = reader.IsDBNull(0) ? (decimal?)null : reader.GetDecimal(0);
                var charg = reader.IsDBNull(1) ? (int?)null : reader.GetInt32(1);
                var paidAmt = reader.GetDecimal(2);
                var ccy = reader.GetInt32(3);
                var invTo = reader.GetInt32(4);
                var intCode = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5);
                var intSeq = reader.IsDBNull(6) ? (int?)null : reader.GetInt32(6);
                var prfCode = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7);

                decimal usd;
                if (ccy == 1)
                    usd = activeRate > 0 ? Math.Round(paidAmt / activeRate, 0, MidpointRounding.AwayFromZero) : paidAmt;
                else
                    usd = paidAmt;

                // Dedup check matching PB: entity_code = X AND charg_type_code = Y AND interview_seq_code = Z
                bool found = newRows.Any(r => r.EntityCode == ent && r.ChargTypeCode == charg && r.InterviewSeqCode == intSeq);
                if (!found)
                {
                    newRows.Add(new CompanyInvoicing
                    {
                        EntityCode = ent,
                        PrfownCode = prfCode,
                        ResourceType = "IT",
                        TotalIncomePkr = paidAmt,
                        TotalUsdCost = (int)usd,
                        ShareAmount = 0m,
                        ExchangeRate = activeRate,
                        ChargedAmtUsd = usd,
                        ProjectCode = null,
                        SecondaryDevCode = null,
                        InvoiceTo = invTo,
                        InvoiceMonth = cleanMonth,
                        Ccy = ccy,
                        ChargTypeCode = charg,
                        InterviewCode = intCode,
                        InterviewSeqCode = intSeq,
                        SupportStatus = null,
                        MonthDays = null,
                        ProRateDays = null,
                        InsertBy = username,
                        InsertTime = DateTime.UtcNow,
                        Status = null
                    });
                }
            }
        }

        // PB STEP 2D: uf_terms_condition - Other Expenses (OE)
        using (var cmd = CreateDbCommand(conn))
        {
            var oeSql = @"
                SELECT 
                    oe.prfown_code,
                    oe.charg_type_code,
                    COALESCE(oe.Amount, 0) AS amount,
                    COALESCE(oe.ccy, 1) AS ccy,
                    COALESCE(oe.invoice_to, 1) AS invoice_to
                FROM HRMSALARY.Other_expenses oe
                WHERE REPLACE(RTRIM(oe.Month_Year), '-', '') = @m";

            if (isSingle)
                oeSql += " AND oe.prfown_code = @owner";

            cmd.CommandText = oeSql;
            var param = cmd.CreateParameter();
            param.ParameterName = "@m";
            param.Value = cleanMonth;
            cmd.Parameters.Add(param);

            if (isSingle)
            {
                var pOwner = cmd.CreateParameter();
                pOwner.ParameterName = "@owner";
                pOwner.Value = request.ProfileOwnerId!.Value;
                cmd.Parameters.Add(pOwner);
            }

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var prfCode = reader.IsDBNull(0) ? (int?)null : reader.GetInt32(0);
                var charg = reader.IsDBNull(1) ? (int?)null : reader.GetInt32(1);
                var amount = reader.GetDecimal(2);
                var ccy = reader.GetInt32(3);
                var invTo = reader.GetInt32(4);

                decimal usd;
                if (ccy == 1)
                    usd = activeRate > 0 ? Math.Round(amount / activeRate, 0, MidpointRounding.AwayFromZero) : amount;
                else
                    usd = amount;

                // In PB, find check is commented out: every OE record is added
                newRows.Add(new CompanyInvoicing
                {
                    EntityCode = null,
                    PrfownCode = prfCode,
                    ResourceType = "OE",
                    TotalIncomePkr = amount,
                    TotalUsdCost = (int)usd,
                    ShareAmount = 0m,
                    ExchangeRate = activeRate,
                    ChargedAmtUsd = usd,
                    ProjectCode = null,
                    SecondaryDevCode = null,
                    InvoiceTo = invTo,
                    InvoiceMonth = cleanMonth,
                    Ccy = ccy,
                    ChargTypeCode = charg,
                    InterviewCode = null,
                    InterviewSeqCode = null,
                    SupportStatus = null,
                    MonthDays = null,
                    ProRateDays = null,
                    InsertBy = username,
                    InsertTime = DateTime.UtcNow,
                    Status = null
                });
            }
        }

        // PB STEP 4: uf_get_invoice_number & uf_get_stagewise_maxno('CINV')
        // Determine starting primary key sequence safely to avoid any PK collision (Error 2627)
        long maxExistingSeq = 0;
        using (var maxCmd = CreateDbCommand(conn))
        {
            maxCmd.CommandText = "SELECT ISNULL(MAX(cmp_invoice_seq_code), 0) FROM dbo.company_invoicing";
            var maxObj = await maxCmd.ExecuteScalarAsync(ct);
            maxExistingSeq = Convert.ToInt64(maxObj);
        }

        long currentLastNo = 0;
        using (var numCmd = CreateDbCommand(conn))
        {
            numCmd.CommandText = "SELECT ISNULL(MAX(LastNo), 0) FROM dbo.NumberControl WHERE StageName IN ('CINV', 'company_invoicing')";
            var numObj = await numCmd.ExecuteScalarAsync(ct);
            if (numObj != null && numObj != DBNull.Value)
                currentLastNo = Convert.ToInt64(numObj);
        }

        long baseSeq = Math.Max(maxExistingSeq, currentLastNo);

        string monthPart = cleanMonth.Length >= 3 ? cleanMonth.Substring(0, 3) : cleanMonth;
        int counter = 0;
        foreach (var r in newRows)
        {
            counter++;
            baseSeq++;
            r.InvoiceNumber = $"INV-{monthPart}-{counter}";
            r.CmpInvoiceSeqCode = (int)baseSeq;
        }

        // Sync NumberControl table atomically matching PB uf_get_stagewise_maxno
        using (var updateNumCmd = CreateDbCommand(conn))
        {
            updateNumCmd.CommandText = @"
                IF EXISTS (SELECT 1 FROM dbo.NumberControl WHERE StageName = 'CINV')
                    UPDATE dbo.NumberControl SET LastNo = @maxNo WHERE StageName = 'CINV';
                ELSE
                    INSERT INTO dbo.NumberControl (StageName, LastNo) VALUES ('CINV', @maxNo);

                IF EXISTS (SELECT 1 FROM dbo.NumberControl WHERE StageName = 'company_invoicing')
                    UPDATE dbo.NumberControl SET LastNo = @maxNo WHERE StageName = 'company_invoicing';
                ELSE
                    INSERT INTO dbo.NumberControl (StageName, LastNo) VALUES ('company_invoicing', @maxNo);
            ";
            var pMax = updateNumCmd.CreateParameter();
            pMax.ParameterName = "@maxNo";
            pMax.Value = baseSeq;
            updateNumCmd.Parameters.Add(pMax);
            await updateNumCmd.ExecuteNonQueryAsync(ct);
        }

        _context.CompanyInvoices.AddRange(newRows);
        await _context.SaveChangesAsync(ct);

        var dtos = await GetCompanyInvoicesAsync(cleanMonth, ct);
        if (isSingle)
            dtos = dtos.Where(d => d.PrfownCode == request.ProfileOwnerId!.Value).ToList();

        return new CalculateCompanyInvoicesResponse(
            MonthYear:          cleanMonth,
            TotalRows:          dtos.Count,
            TotalChargedUsd:    dtos.Sum(d => d.ChargedAmtUsd ?? 0),
            TotalSilmunUsd:     dtos.Where(d => d.InvoiceTo == 1).Sum(d => d.FinalUsd ?? d.ChargedAmtUsd ?? 0),
            TotalPaidExpCostUsd:dtos.Where(d => d.InvoiceTo == 2).Sum(d => d.UsdCost ?? 0),
            TotalPaidExpShareUsd:dtos.Where(d => d.InvoiceTo == 2).Sum(d => d.TotalReceivableAmount ?? 0),
            Rows:               dtos
        );
    }

    public async Task<bool> PostCompanyInvoicesAsync(
        string monthYear, bool replaceExisting, string username, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();

        var rows = await _context.CompanyInvoices
            .Where(c => c.InvoiceMonth != null && c.InvoiceMonth.Trim().Replace("-", "") == cleanMonth && c.Status != "P")
            .ToListAsync(ct);

        if (!rows.Any())
            return false;

        foreach (var row in rows)
        {
            row.Status           = "P";
            row.PostedDt         = DateTime.UtcNow;
            row.LastModifiedBy   = username;
            row.LastModifiedTime = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync(ct);
        return true;
    }

    // ── Advance Funds ────────────────────────────────────────────────────────

    public async Task<List<AdvanceFundDto>> GetAdvanceFundsAsync(
        string monthYear, CancellationToken ct = default)
    {
        var vendors = await GetVendorNamesAsync(ct);
        var rows = await _context.InvoiceAdvanceFunds.AsNoTracking()
            .Where(a => a.MonthYear == monthYear)
            .OrderBy(a => a.InvoiceCode)
            .ToListAsync(ct);

        return rows.Select(a => new AdvanceFundDto(
            InvoiceCode:  a.InvoiceCode,
            MonthYear:    a.MonthYear,
            InvoiceTo:    a.InvoiceTo,
            VendorName:   a.InvoiceTo.HasValue && vendors.ContainsKey(a.InvoiceTo.Value)
                              ? vendors[a.InvoiceTo.Value] : null,
            Amount:       a.Amount ?? 0m,
            Ccy:          a.Ccy ?? 2,
            CurrencyName: a.Ccy == 1 ? "PKR" : "USD",
            Remarks:      a.Remarks,
            InsertTime:   a.InsertTime,
            InsertBy:     a.InsertBy
        )).ToList();
    }

    public async Task<AdvanceFundDto> CreateAdvanceFundAsync(
        CreateAdvanceFundRequest request, string username, CancellationToken ct = default)
    {
        // Guard: can't add advance if month is finalized
        var hasFinal = await _context.FinalInvoices.AnyAsync(f => f.MonthYear == request.MonthYear, ct);
        if (hasFinal)
            throw new InvalidOperationException(
                $"Month '{request.MonthYear}' is finalized. Cannot add advance funds.");

        var seqCode = await _seq.GetNextSequenceAsync("invoice_advance_funds", ct);

        var fund = new InvoiceAdvanceFund
        {
            InvoiceCode = (int)seqCode,
            MonthYear   = request.MonthYear,
            InvoiceTo   = request.InvoiceTo,
            Amount      = request.Amount,
            Ccy         = request.Ccy,
            Remarks     = request.Remarks,
            InsertBy    = username,
            InsertTime  = DateTime.UtcNow
        };

        _context.InvoiceAdvanceFunds.Add(fund);
        await _context.SaveChangesAsync(ct);

        var vendors = await GetVendorNamesAsync(ct);
        return new AdvanceFundDto(
            InvoiceCode:  fund.InvoiceCode,
            MonthYear:    fund.MonthYear,
            InvoiceTo:    fund.InvoiceTo,
            VendorName:   fund.InvoiceTo.HasValue && vendors.ContainsKey(fund.InvoiceTo.Value)
                              ? vendors[fund.InvoiceTo.Value] : null,
            Amount:       fund.Amount ?? 0m,
            Ccy:          fund.Ccy ?? 2,
            CurrencyName: fund.Ccy == 1 ? "PKR" : "USD",
            Remarks:      fund.Remarks,
            InsertTime:   fund.InsertTime,
            InsertBy:     fund.InsertBy
        );
    }

    public async Task<bool> DeleteAdvanceFundAsync(
        int invoiceCode, string monthYear, CancellationToken ct = default)
    {
        // Guard: can't delete if finalized
        var hasFinal = await _context.FinalInvoices.AnyAsync(f => f.MonthYear == monthYear, ct);
        if (hasFinal)
            throw new InvalidOperationException(
                $"Month '{monthYear}' is finalized. Cannot delete advance fund record.");

        var fund = await _context.InvoiceAdvanceFunds
            .FirstOrDefaultAsync(a => a.InvoiceCode == invoiceCode && a.MonthYear == monthYear, ct);
        if (fund == null) return false;

        _context.InvoiceAdvanceFunds.Remove(fund);
        await _context.SaveChangesAsync(ct);
        return true;
    }

    // ── Final Invoicing ──────────────────────────────────────────────────────

    public async Task<FinalInvoiceCalculationResult> CalculateFinalInvoicePreviewAsync(
        string monthYear, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();

        var compRows = await _context.CompanyInvoices.AsNoTracking()
            .Where(c => c.InvoiceMonth != null && c.InvoiceMonth.Trim().Replace("-", "") == cleanMonth)
            .ToListAsync(ct);

        var advRows = await _context.InvoiceAdvanceFunds.AsNoTracking()
            .Where(a => a.MonthYear != null && a.MonthYear.Trim().Replace("-", "") == cleanMonth)
            .ToListAsync(ct);

        var vendors = await GetVendorNamesAsync(ct);

        // PowerBuilder uf_final_calculate logic:
        // Silmun is vend_code = 1 (Full charged amount)
        decimal silmunCharged = compRows
            .Where(c => c.InvoiceTo == 1)
            .Sum(c => c.ChargedAmtUsd ?? 0m);

        // Paid Exp (vend_code = 2) - Only Cost, NOT charged amount
        decimal paidExpCost = compRows
            .Where(c => c.InvoiceTo == 2)
            .Sum(c => (decimal)(c.TotalUsdCost ?? 0));

        // Paid Exp share separate
        decimal paidExpShare = compRows
            .Where(c => c.InvoiceTo == 2)
            .Sum(c => c.ShareAmount ?? 0m);

        // Silmun Total = Silmun charged + paid exp share
        decimal silmunTotal = Math.Round(silmunCharged + paidExpShare, 2);

        // Paid expenses total = paid exp cost
        decimal paidExpensesTotal = Math.Round(paidExpCost, 2);

        // All total (stored as silmun_invoice_amt in dbo.final_invoicing) = silmun + share + cost
        decimal totalAllRevenue = Math.Round(silmunCharged + paidExpShare + paidExpCost, 2);

        // Total advance funds for month
        decimal advancesAmt = Math.Round(advRows.Sum(a => a.Amount ?? 0m), 2);

        // Final payable = silmun_total - advances
        decimal finalAmt = Math.Round(silmunTotal - advancesAmt, 2);

        bool hasMismatch = advRows.Any(a => a.Ccy != 2);

        var savedRecord = await _context.FinalInvoices.AsNoTracking()
            .FirstOrDefaultAsync(f => f.MonthYear != null && f.MonthYear.Trim().Replace("-", "") == cleanMonth, ct);

        var advanceDtos = advRows.Select(a => new AdvanceFundDto(
            InvoiceCode: a.InvoiceCode,
            MonthYear: a.MonthYear?.Trim() ?? cleanMonth,
            InvoiceTo: a.InvoiceTo,
            VendorName: (a.InvoiceTo.HasValue && vendors.TryGetValue(a.InvoiceTo.Value, out var vName)) ? vName : $"Vendor {a.InvoiceTo}",
            Amount: a.Amount ?? 0m,
            Ccy: a.Ccy ?? 2,
            CurrencyName: (a.Ccy ?? 2) switch { 1 => "PKR", 2 => "USD", 3 => "GBP", _ => "USD" },
            Remarks: a.Remarks,
            InsertTime: a.InsertTime,
            InsertBy: a.InsertBy
        )).ToList();

        return new FinalInvoiceCalculationResult(
            MonthYear: cleanMonth,
            SilmunInvoiceAmt: silmunTotal,
            PaidInvoiceAmt: paidExpensesTotal,
            TotalAllRevenue: totalAllRevenue,
            AdvancesFundAmt: advancesAmt,
            FinalInvoiceAmt: finalAmt,
            HasCurrencyMismatch: hasMismatch,
            CompanyInvoiceRowCount: compRows.Count,
            AdvanceCount: advRows.Count,
            IsFinalized: savedRecord != null,
            InvCode: savedRecord?.InvCode,
            InsertBy: savedRecord?.InsertBy,
            InsertTime: savedRecord?.InsertTime,
            AdvanceFunds: advanceDtos
        );
    }

    public async Task<FinalInvoiceDto> SaveFinalInvoiceAsync(
        string monthYear, string username, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();

        // Guard: reject if already finalized
        var existing = await _context.FinalInvoices
            .FirstOrDefaultAsync(f => f.MonthYear != null && f.MonthYear.Trim().Replace("-", "") == cleanMonth, ct);
        if (existing != null)
            throw new InvalidOperationException(
                $"Final invoice already exists for month {cleanMonth}. Please load existing record to update.");

        var hasInvoices = await _context.CompanyInvoices.AnyAsync(
            c => c.InvoiceMonth != null && c.InvoiceMonth.Trim().Replace("-", "") == cleanMonth, ct);
        if (!hasInvoices)
            throw new InvalidOperationException(
                $"No company invoices found for month '{cleanMonth}'. Please calculate company invoices first.");

        var preview = await CalculateFinalInvoicePreviewAsync(cleanMonth, ct);

        // PowerBuilder: il_company_invoice = uf_get_stagewise_maxno('FIN')
        var seqCode = await _seq.GetNextSequenceAsync("FIN", ct);

        var finalRecord = new FinalInvoicing
        {
            InvCode          = (int)seqCode,
            MonthYear        = cleanMonth,
            InvoiceTo        = 1, // Silmun
            SilmunInvoiceAmt = preview.TotalAllRevenue,  // PB stores ld_all_total
            PaidInvoiceAmt   = preview.PaidInvoiceAmt,   // PB stores ld_paid_exp_total
            AdvancesFundAmt  = preview.AdvancesFundAmt,  // PB stores ld_adv_total
            FinalInvoiceAmt  = preview.FinalInvoiceAmt,  // PB stores ld_final_total
            InsertBy         = username,
            InsertTime       = DateTime.UtcNow
        };

        _context.FinalInvoices.Add(finalRecord);
        await _context.SaveChangesAsync(ct);

        // Also update invoice_advance_funds denormalized columns matching d_rpt_final_invoice
        var advRecords = await _context.InvoiceAdvanceFunds
            .Where(a => a.MonthYear != null && a.MonthYear.Trim().Replace("-", "") == cleanMonth)
            .ToListAsync(ct);
        foreach (var adv in advRecords)
        {
            adv.SilmunTotal = preview.SilmunInvoiceAmt;
            adv.PaidExpense = preview.PaidInvoiceAmt;
            adv.TotalAdvance = preview.AdvancesFundAmt;
            adv.TotalInvoice = preview.FinalInvoiceAmt;
            adv.UpdateBy = username;
            adv.UpdateTime = DateTime.UtcNow;
        }
        if (advRecords.Any())
        {
            await _context.SaveChangesAsync(ct);
        }

        var vendors = await GetVendorNamesAsync(ct);
        return MapFinal(finalRecord, vendors);
    }

    public async Task<FinalInvoiceDto?> GetFinalInvoiceAsync(
        string monthYear, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();
        var record = await _context.FinalInvoices.AsNoTracking()
            .FirstOrDefaultAsync(f => f.MonthYear != null && f.MonthYear.Trim().Replace("-", "") == cleanMonth, ct);
        if (record == null) return null;

        var vendors = await GetVendorNamesAsync(ct);
        return MapFinal(record, vendors);
    }

    // ── Dashboard ────────────────────────────────────────────────────────────

    private static List<string>? _cachedBillingMonths;
    private static DateTime _cachedBillingMonthsExpiry = DateTime.MinValue;
    private static readonly object _billingMonthsLock = new object();

    public async Task<List<string>> GetAvailableBillingMonthsAsync(CancellationToken ct = default)
    {
        lock (_billingMonthsLock)
        {
            if (_cachedBillingMonths != null && DateTime.UtcNow < _cachedBillingMonthsExpiry)
            {
                return new List<string>(_cachedBillingMonths);
            }
        }

        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var conn = _context.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open)
            await conn.OpenAsync(ct);

        using (var cmd = CreateDbCommand(conn))
        {
            cmd.CommandText = @"
                SELECT DISTINCT REPLACE(RTRIM(invoice_month), '-', '') FROM dbo.company_invoicing WHERE invoice_month IS NOT NULL AND LTRIM(RTRIM(invoice_month)) <> ''
                UNION
                SELECT DISTINCT REPLACE(RTRIM(invoice_month), '-', '') FROM dbo.Profile_invoicing WHERE invoice_month IS NOT NULL AND LTRIM(RTRIM(invoice_month)) <> ''
                UNION
                SELECT DISTINCT REPLACE(RTRIM(month_year), '-', '') FROM dbo.final_invoicing WHERE month_year IS NOT NULL AND LTRIM(RTRIM(month_year)) <> ''
                UNION
                SELECT DISTINCT REPLACE(RTRIM(month_year), '-', '') FROM dbo.invoice_advance_funds WHERE month_year IS NOT NULL AND LTRIM(RTRIM(month_year)) <> ''";

            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                if (!rdr.IsDBNull(0))
                {
                    var m = rdr.GetString(0).Trim().ToUpperInvariant();
                    if (!string.IsNullOrWhiteSpace(m))
                        set.Add(m);
                }
            }
        }

        // Return sorted descending chronologically (e.g. OCT26, SEP26, MAY26, APR26)
        var result = set.OrderByDescending(ParseMonthSortKey).ToList();
        lock (_billingMonthsLock)
        {
            _cachedBillingMonths = result;
            _cachedBillingMonthsExpiry = DateTime.UtcNow.AddMinutes(5);
        }
        return result;
    }

    private static int ParseMonthSortKey(string monthYear)
    {
        if (string.IsNullOrWhiteSpace(monthYear)) return 0;
        var s = monthYear.Trim().Replace("-", "").ToUpperInvariant();
        if (s.Length >= 5)
        {
            var monStr = s.Substring(0, 3);
            var yrStr = s.Substring(3);
            if (int.TryParse(yrStr, out var yr))
            {
                int fullYear = yr < 50 ? 2000 + yr : 1900 + yr;
                int mon = monStr switch
                {
                    "JAN" => 1, "FEB" => 2, "MAR" => 3, "APR" => 4,
                    "MAY" => 5, "JUN" => 6, "JUL" => 7, "AUG" => 8,
                    "SEP" => 9, "OCT" => 10, "NOV" => 11, "DEC" => 12,
                    _ => 0
                };
                return fullYear * 100 + mon;
            }
        }
        return 0;
    }

    public async Task<DashboardSummaryDto> GetDashboardSummaryAsync(string? month = null, CancellationToken ct = default)
    {
        var availableMonths = await GetAvailableBillingMonthsAsync(ct);
        string cleanMonth = !string.IsNullOrWhiteSpace(month)
            ? month.Trim().Replace("-", "").ToUpperInvariant()
            : (availableMonths.FirstOrDefault() ?? "OCT26");

        // Ensure lookups are cached in memory (0ms on cache hit)
        await EnsureLookupsCachedAsync(ct);
        var vendors         = _cachedVendors ?? new();
        var profiles        = _cachedProfiles ?? new();
        var projects        = _cachedProjects ?? new();
        var entities        = _cachedEntities ?? new();
        var projectBranches = _cachedBranches ?? new();

        // ── Raw-SQL grouping instead of EF GroupBy (much faster on RDS) ──────
        var conn = _context.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

        // Monthly summary from company_invoicing
        var cmpByMonth = new List<(string MonthYear, int InvoiceCount, decimal TotalChargedUsd, decimal TotalIncomePkr)>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandTimeout = 30;
            cmd.CommandText = @"
                SELECT ISNULL(invoice_month,''), COUNT(*), 
                       SUM(ISNULL(charged_amt_usd,0)), SUM(ISNULL(total_income_pkr,0))
                FROM dbo.company_invoicing
                GROUP BY invoice_month";
            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                cmpByMonth.Add((rdr.GetString(0).Trim(), rdr.GetInt32(1), rdr.GetDecimal(2), rdr.GetDecimal(3)));
        }

        // Stats for selected month
        var monthRow = cmpByMonth.FirstOrDefault(r => r.MonthYear.Replace("-","").ToUpper() == cleanMonth);
        var totalUsdCharged    = monthRow.TotalChargedUsd;
        var totalPkrIncome     = monthRow.TotalIncomePkr;
        var activeInvoiceCount = monthRow.InvoiceCount;

        // Fallback: use all invoices if selected month has 0
        if (activeInvoiceCount == 0 && string.IsNullOrWhiteSpace(month))
        {
            totalUsdCharged    = cmpByMonth.Sum(r => r.TotalChargedUsd);
            totalPkrIncome     = cmpByMonth.Sum(r => r.TotalIncomePkr);
            activeInvoiceCount = cmpByMonth.Sum(r => r.InvoiceCount);
        }

        // Final invoices & advances (small tables — fast)
        var finals   = await _context.FinalInvoices.AsNoTracking()
            .OrderByDescending(f => f.MonthYear).Take(12).ToListAsync(ct);
        var advances = await _context.InvoiceAdvanceFunds.AsNoTracking().ToListAsync(ct);

        var cmpMonthMap = cmpByMonth.ToDictionary(x => x.MonthYear.Replace("-","").ToUpper());

        var trends = finals.Select(f =>
        {
            var mKey = f.MonthYear.Trim().Replace("-","").ToUpper();
            var advAmt = advances.Where(a => a.MonthYear.Trim().Replace("-","").ToUpper() == mKey).Sum(a => a.Amount ?? 0m);
            cmpMonthMap.TryGetValue(mKey, out var cStats);
            return new MonthlyTrendDto(
                f.MonthYear,
                f.SilmunInvoiceAmt ?? 0m,
                advAmt,
                f.FinalInvoiceAmt ?? 0m,
                cStats.TotalChargedUsd > 0 ? cStats.TotalChargedUsd : (f.SilmunInvoiceAmt ?? 0m),
                cStats.TotalIncomePkr,
                cStats.InvoiceCount);
        }).OrderBy(t => t.MonthYear).ToList();

        foreach (var c in cmpByMonth)
        {
            var mKey = c.MonthYear.Replace("-","").ToUpper();
            if (!trends.Any(t => t.MonthYear.Trim().Replace("-","").ToUpper() == mKey))
            {
                trends.Add(new MonthlyTrendDto(c.MonthYear, c.TotalChargedUsd, 0m,
                    c.TotalChargedUsd, c.TotalChargedUsd, c.TotalIncomePkr, c.InvoiceCount));
            }
        }

        // Top 5 vendors for selected month — raw SQL
        var topDtos = new List<TopCompanyDto>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandTimeout = 20;
            cmd.CommandText = activeInvoiceCount > 0
                ? $@"SELECT TOP 5 ISNULL(invoice_to,0), SUM(ISNULL(charged_amt_usd,0)), COUNT(*)
                     FROM dbo.company_invoicing
                     WHERE REPLACE(ISNULL(invoice_month,''),'-','') = '{cleanMonth}'
                     GROUP BY invoice_to ORDER BY SUM(ISNULL(charged_amt_usd,0)) DESC"
                : @"SELECT TOP 5 ISNULL(invoice_to,0), SUM(ISNULL(charged_amt_usd,0)), COUNT(*)
                   FROM dbo.company_invoicing
                   GROUP BY invoice_to ORDER BY SUM(ISNULL(charged_amt_usd,0)) DESC";
            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var vc = rdr.GetInt32(0);
                topDtos.Add(new TopCompanyDto(
                    VendorCode:      vc,
                    VendorName:      vendors.TryGetValue(vc, out var vn) ? vn : $"Vendor {vc}",
                    TotalChargedUsd: rdr.GetDecimal(1),
                    InvoiceCount:    rdr.GetInt32(2)));
            }
        }

        // Recent 20 invoices for selected month — EF query (simpler, avoids type mapping)
        var recentDbQuery = activeInvoiceCount > 0
            ? _context.CompanyInvoices.AsNoTracking()
                .Where(c => c.InvoiceMonth != null && c.InvoiceMonth.Replace("-", "").ToUpper() == cleanMonth)
            : _context.CompanyInvoices.AsNoTracking();
        var recentRows = await recentDbQuery
            .OrderByDescending(c => c.InsertTime)
            .Take(20)
            .ToListAsync(ct);
        var recentDtos = recentRows
            .Select(c => MapCompany(c, vendors, profiles, projects, entities, null, null, null, projectBranches))
            .ToList();

        // Specific settlement numbers for selected month
        var monthFinal = finals.FirstOrDefault(f => f.MonthYear != null && f.MonthYear.Trim().Replace("-", "").ToUpper() == cleanMonth);
        var monthAdvances = advances.Where(a => a.MonthYear != null && a.MonthYear.Trim().Replace("-", "").ToUpper() == cleanMonth).ToList();

        decimal totalInvoiced;
        decimal totalAdvances = monthAdvances.Sum(a => a.Amount ?? 0m);
        decimal totalUtilized;

        if (monthFinal != null)
        {
            totalInvoiced = monthFinal.SilmunInvoiceAmt ?? 0m;
            totalUtilized = monthFinal.AdvancesFundAmt ?? 0m;
        }
        else
        {
            totalInvoiced = totalUsdCharged;
            totalUtilized = 0m;
        }

        decimal totalOutstanding = Math.Max(0m, totalInvoiced - totalAdvances);

        return new DashboardSummaryDto(
            TotalInvoicedRevenueUsd:  totalInvoiced,
            TotalAdvanceReceivedUsd:  totalAdvances,
            TotalAdvanceUtilizedUsd:  totalUtilized,
            TotalOutstandingUsd:      totalOutstanding,
            LatestMonth:              cleanMonth,
            TotalUsdCharged:          totalUsdCharged,
            TotalPkrIncome:           totalPkrIncome,
            ActiveInvoiceCount:       activeInvoiceCount,
            MonthlyTrends:            trends,
            TopCompanies:             topDtos,
            TopVendors:               topDtos,
            RecentInvoices:           recentDtos,
            RecentCompanyInvoices:    recentDtos,
            AvailableMonths:          availableMonths
        );
    }

    // ── Excel Export ─────────────────────────────────────────────────────────

    public async Task<byte[]> ExportCompanyInvoicesExcelAsync(
        string monthYear, CancellationToken ct = default)
    {
        var dtos = await GetCompanyInvoicesAsync(monthYear, ct);
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add($"Company Invoices {cleanMonth}");

        // Headers matching PB uf_calculate_salary
        var headers = new[]
        {
            "Stack", "Profile Owner", "Developer", "Project Number", "Service Head",
            "USD Cost", "Rizviz Share", "Final USD", "Total Receivable Amount", "Invoice To"
        };
        for (int col = 1; col <= headers.Length; col++)
        {
            var cell = ws.Cell(1, col);
            cell.Value = headers[col - 1];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromArgb(0x1F, 0x35, 0x64);
            cell.Style.Font.FontColor = XLColor.White;
        }

        decimal totalInvoice1 = 0m;
        decimal totalInvoice2 = 0m;
        decimal totalInvoice2Share = 0m;

        int row = 2;
        foreach (var dto in dtos)
        {
            decimal usdCost = dto.UsdCost ?? dto.ChargedAmtUsd ?? 0m;
            decimal shareAmount = dto.RizvizShare ?? dto.ShareAmount ?? 0m;
            decimal finalUsd = dto.FinalUsd ?? (usdCost + shareAmount);
            decimal receivable = dto.TotalReceivableAmount ?? finalUsd;

            if (dto.InvoiceTo == 1) totalInvoice1 += finalUsd;
            if (dto.InvoiceTo == 2)
            {
                totalInvoice2 += usdCost;
                totalInvoice2Share += receivable;
            }

            ws.Cell(row, 1).Value  = dto.Stack ?? "";
            ws.Cell(row, 2).Value  = dto.ProfileOwnerName ?? "";
            ws.Cell(row, 3).Value  = dto.DeveloperName ?? "";
            ws.Cell(row, 4).Value  = dto.ProjectCode?.ToString() ?? "";
            ws.Cell(row, 5).Value  = dto.ServiceHead ?? "";
            ws.Cell(row, 6).Value  = (double)usdCost;
            ws.Cell(row, 7).Value  = (double)shareAmount;
            ws.Cell(row, 8).Value  = (double)finalUsd;
            ws.Cell(row, 9).Value  = (double)receivable;
            ws.Cell(row, 10).Value = dto.VendorName ?? dto.InvoiceTo.ToString();

            for (int c = 6; c <= 9; c++)
                ws.Cell(row, c).Style.NumberFormat.Format = "#,##0.00";

            row++;
        }

        // Summary rows matching PB uf_calculate_salary
        decimal silmunTotal = Math.Round(totalInvoice1 + totalInvoice2Share, 2, MidpointRounding.AwayFromZero);

        row++;
        ws.Cell(row, 1).Value = "INVOICE SUMMARY";
        ws.Cell(row, 1).Style.Font.Bold = true;
        row++;

        ws.Cell(row, 1).Value = "Invoice To Silmun Amount";
        ws.Cell(row, 9).Value = (double)totalInvoice1;
        ws.Cell(row, 9).Style.NumberFormat.Format = "#,##0.00";
        ws.Cell(row, 9).Style.Font.Bold = true;
        row++;

        ws.Cell(row, 1).Value = "Paid Expense Without Share Amount";
        ws.Cell(row, 6).Value = (double)totalInvoice2;
        ws.Cell(row, 6).Style.NumberFormat.Format = "#,##0.00";
        row++;

        ws.Cell(row, 1).Value = "Paid Expense Rizviz Share";
        ws.Cell(row, 7).Value = (double)totalInvoice2Share;
        ws.Cell(row, 7).Style.NumberFormat.Format = "#,##0.00";
        row++;

        ws.Cell(row, 1).Value = "────────────────────────────────────────";
        row++;

        ws.Cell(row, 1).Value = "SILMUN TOTAL Invoice";
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 9).Value = (double)silmunTotal;
        ws.Cell(row, 9).Style.NumberFormat.Format = "#,##0.00";
        ws.Cell(row, 9).Style.Font.Bold = true;

        ws.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ── Private Mappers ──────────────────────────────────────────────────────

    private static CompanyInvoiceDto MapCompany(
        CompanyInvoicing c,
        Dictionary<int, string> vendors,
        Dictionary<int, string> profiles,
        Dictionary<int, string> projects,
        Dictionary<decimal, string> entities,
        Dictionary<decimal, string>? stacks = null,
        Dictionary<(decimal, int, int), MktProjectInvoicing>? mktDict = null,
        Dictionary<string, string>? serviceHeads = null,
        Dictionary<int, int>? projectBranches = null,
        Dictionary<int, string>? projectStacks = null,
        Dictionary<int, string>? chargibilities = null)
    {
        string? vendorName   = vendors.TryGetValue(c.InvoiceTo, out var vn) ? vn : null;
        string? profileName  = c.PrfownCode.HasValue && profiles.ContainsKey(c.PrfownCode.Value)
                                   ? profiles[c.PrfownCode.Value] : null;
        string? projectName  = c.ProjectCode.HasValue && projects.ContainsKey(c.ProjectCode.Value)
                                   ? projects[c.ProjectCode.Value] : null;

        // PB Developer Name logic: If SP and secondary_dev_code > 0 -> secondary dev name, else entity name
        string? entityName = null;
        if (string.Equals(c.ResourceType?.Trim(), "SP", StringComparison.OrdinalIgnoreCase) &&
            c.SecondaryDevCode.HasValue && c.SecondaryDevCode.Value > 0 &&
            entities.TryGetValue(c.SecondaryDevCode.Value, out var secDev))
        {
            entityName = secDev;
        }
        else if (c.EntityCode.HasValue && entities.TryGetValue(c.EntityCode.Value, out var ent))
        {
            entityName = ent;
        }

        // PB Stack logic: Stack comes from mkt.Projects.stack_cde
        string? stackName = null;
        if (c.ProjectCode.HasValue && projectStacks != null && projectStacks.TryGetValue(c.ProjectCode.Value, out var ps))
            stackName = ps;
        else if (c.EntityCode.HasValue && stacks != null && stacks.TryGetValue(c.EntityCode.Value, out var es))
            stackName = es;

        int? branchCode = c.ProjectCode.HasValue && projectBranches != null && projectBranches.TryGetValue(c.ProjectCode.Value, out var bc)
            ? bc : null;
        bool isForeign = branchCode == 5;

        MktProjectInvoicing? mkt = null;
        if (mktDict != null && c.EntityCode.HasValue && c.ProjectCode.HasValue)
        {
            mktDict.TryGetValue((c.EntityCode.Value, c.ProjectCode.Value, c.InvoiceTo), out mkt);
        }

        decimal? usdCost = c.TotalUsdCost.HasValue ? (decimal)c.TotalUsdCost.Value : null;
        decimal? rizvizShare = c.ShareAmount;
        decimal? finalUsd = c.ChargedAmtUsd;
        decimal? totalReceivable = c.InvoiceTo == 1 ? finalUsd : (c.ShareAmount ?? 0m);

        string? secDevName = null;
        if (c.SecondaryDevCode.HasValue && entities.TryGetValue(c.SecondaryDevCode.Value, out var sdn))
        {
            secDevName = sdn;
        }

        // PB Service Head logic
        string serviceHeadName = "";
        var rType = (c.ResourceType ?? mkt?.ResourceType ?? "").Trim().ToUpperInvariant();
        if (!string.IsNullOrEmpty(rType))
        {
            serviceHeadName = rType switch
            {
                "JH" => "Job Holder",
                "SP" => "Support Provider",
                "SL" => "Special",
                "DR" => "Second Resource",
                "B"  => "BD-Commission",
                "E"  => "BD Recurr. Comm. - EXE",
                "R"  => "BD Recurr. Comm. - REG",
                "I"  => "Interview Comm. - 1st",
                "J"  => "Interview Comm. - 2nd",
                "X"  => "DEV Recurr. Comm.",
                "TZ" => "TimeZone Allowance",
                "BO" => "Bonus",
                "TL" => "TL-Allounce",
                "BS" => "DEV/Marketing",
                "IT" => "Interview",
                "OE" => "Other Expense",
                _    => ""
            };
        }
        if (string.IsNullOrEmpty(serviceHeadName) && c.ChargTypeCode.HasValue && chargibilities != null && chargibilities.TryGetValue(c.ChargTypeCode.Value, out var chName))
        {
            serviceHeadName = chName;
        }
        if (string.IsNullOrEmpty(serviceHeadName) && !string.IsNullOrEmpty(rType) && serviceHeads != null && serviceHeads.TryGetValue(rType, out var shDesc))
        {
            serviceHeadName = shDesc;
        }
        if (string.IsNullOrEmpty(serviceHeadName))
        {
            serviceHeadName = c.ResourceType ?? "";
        }

        return new CompanyInvoiceDto(
            CmpInvoiceSeqCode: c.CmpInvoiceSeqCode,
            InvoiceMonth:      c.InvoiceMonth,
            InvoiceTo:         c.InvoiceTo,
            VendorName:        vendorName,
            EntityCode:        c.EntityCode,
            DeveloperName:     entityName,
            ProjectCode:       c.ProjectCode,
            ProjectName:       projectName,
            PrfownCode:        c.PrfownCode,
            ProfileOwnerName:  profileName,
            ResourceType:      c.ResourceType,
            ChargedAmtUsd:     c.ChargedAmtUsd,
            TotalIncomePkr:    c.TotalIncomePkr,
            TotalUsdCost:      c.TotalUsdCost,
            ShareAmount:       c.ShareAmount,
            ExchangeRate:      c.ExchangeRate,
            InvoiceNumber:     c.InvoiceNumber,
            Status:            c.Status,
            Remarks:           c.Remarks,
            ProRateDays:       c.ProRateDays,
            MonthDays:         c.MonthDays,
            Stack:             stackName,
            ProjectNumber:     c.ProjectCode,
            ServiceHead:       serviceHeadName,
            UsdCost:           usdCost,
            RizvizShare:       rizvizShare,
            FinalUsd:          finalUsd,
            TotalReceivableAmount: totalReceivable,
            BranchCode:        branchCode,
            IsForeign:         isForeign,
            SecondaryDevCode:  c.SecondaryDevCode,
            SecondaryDevName:  secDevName,
            InterviewCode:     c.InterviewCode,
            InterviewSeqCode:  c.InterviewSeqCode,
            ChargTypeCode:     c.ChargTypeCode,
            SupportStatus:     c.SupportStatus,
            Arrears:           c.Arrears,
            Ccy:               c.Ccy
        );
    }

    private static FinalInvoiceDto MapFinal(FinalInvoicing f, Dictionary<int, string> vendors)
    {
        string? vendorName = f.InvoiceTo.HasValue && vendors.ContainsKey(f.InvoiceTo.Value)
                                 ? vendors[f.InvoiceTo.Value] : null;
        return new FinalInvoiceDto(
            InvCode:          f.InvCode,
            MonthYear:        f.MonthYear,
            InvoiceTo:        f.InvoiceTo,
            VendorName:       vendorName,
            SilmunInvoiceAmt: f.SilmunInvoiceAmt ?? 0m,
            PaidInvoiceAmt:   f.PaidInvoiceAmt ?? 0m,
            AdvancesFundAmt:  f.AdvancesFundAmt ?? 0m,
            FinalInvoiceAmt:  f.FinalInvoiceAmt ?? 0m,
            InsertTime:       f.InsertTime,
            InsertBy:         f.InsertBy
        );
    }
}

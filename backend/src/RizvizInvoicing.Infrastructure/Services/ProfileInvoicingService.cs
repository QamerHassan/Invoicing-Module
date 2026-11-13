
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
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Infrastructure.Services;

public class ProfileInvoicingService : IProfileInvoicingService
{
    private readonly InvoicingDbContext _db;

    public ProfileInvoicingService(InvoicingDbContext db)
    {
        _db = db;
    }

    public async Task<ProfileInvoiceDryRunResult> CalculateDryRunAsync(
        int groupOwnerCode, string monthYear, bool bypassDuplicateGuard = false, CancellationToken ct = default)
    {
        var cleanMonth = monthYear.Trim().Replace("-", "").ToUpperInvariant();
        var result = new ProfileInvoiceDryRunResult
        {
            GroupOwnerCode = groupOwnerCode,
            MonthYear = cleanMonth
        };

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        // 1. Resolve Profile Group Owner Name
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT profile_name FROM prof.Profile_Owners WHERE PrfOwn_code = @p";
            cmd.Parameters.Add(new SqlParameter("@p", groupOwnerCode));
            var nameObj = await cmd.ExecuteScalarAsync(ct);
            result.GroupOwnerName = nameObj?.ToString()?.Trim() ?? $"Owner #{groupOwnerCode}";
        }

        // 2. Duplicate Run Safeguard (matches legacy line 16363-16383)
        if (!bypassDuplicateGuard)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT COUNT(*) 
                FROM dbo.Profile_invoicing 
                WHERE prfgrp_own_code = @grp 
                  AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
            cmd.Parameters.Add(new SqlParameter("@grp", groupOwnerCode));
            cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));
            var countObj = await cmd.ExecuteScalarAsync(ct);
            int existingCount = Convert.ToInt32(countObj ?? 0);
            if (existingCount > 0)
            {
                result.AlreadyExists = true;
                result.WarningMessage = $"Invoices already exist for this Profile Group Owner and Month ({result.MonthYear}). Duplicate generation stopped.";
                // Match PB legacy behavior: immediate RETURN, stop generation, produce 0 rows
                return result;
            }
        }


        // 3. Resolve Exchange Rate (matches legacy line 16549-16557: SELECT TOP 1 rate FROM setups.exchange_rate ORDER BY ExchangeRateCode_code ASC)
        decimal exchRate = 0m;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT TOP 1 rate FROM setups.exchange_rate ORDER BY ExchangeRateCode_code ASC";
            var rateObj = await cmd.ExecuteScalarAsync(ct);
            if (rateObj != null && rateObj != DBNull.Value)
            {
                exchRate = Convert.ToDecimal(rateObj);
            }
        }
        result.ExchangeRate = exchRate;

        // 4. Resolve Child Owners (matches legacy cur_child_owners cursor lines 16397-16440)
        var allOwners = new List<int> { groupOwnerCode };
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT PrfOwn_code FROM prof.Profile_Owners WHERE ParentProfile_code = @grp";
            cmd.Parameters.Add(new SqlParameter("@grp", groupOwnerCode));
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int childCode = reader.GetInt32(0);
                if (childCode != groupOwnerCode && !allOwners.Contains(childCode))
                {
                    allOwners.Add(childCode);
                }
            }
        }
        result.OwnerCodes = allOwners;
        result.ChildOwnersCount = allOwners.Count - 1;

        // 5. Lookups for friendly names
        var profileNames = new Dictionary<int, string>();
        var entityNames = new Dictionary<decimal, string>();
        var projectNames = new Dictionary<int, string>();
        var vendorNames = new Dictionary<int, string>();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT PrfOwn_code, profile_name FROM prof.Profile_Owners";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                profileNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT entity_code, Full_name FROM hrms.entity";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                entityNames[reader.GetDecimal(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        var projectStacks = new Dictionary<int, string>();
        var projectBranches = new Dictionary<int, int>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT p.project_Code, p.Proj_name, ISNULL(st.stack_name, ''), ISNULL(p.branch_code, 0)
                FROM mkt.Projects p
                LEFT JOIN setups.Stacks st ON st.stack_code = p.stack_cde";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int pCode = reader.GetInt32(0);
                projectNames[pCode] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
                projectStacks[pCode] = reader.IsDBNull(2) ? "" : reader.GetString(2).Trim();
                projectBranches[pCode] = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT Vend_code, Vend_name FROM setups.vendors";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                vendorNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        // 6. Execute 4-Source Merge
        var excludedChargeTypes = new HashSet<int> { 18, 19, 20, 21, 22, 23, 24, 12, 14, 13 };
        var rows = new List<ProfileInvoiceRowDto>();

        int compCount = 0;
        int intCount = 0;
        int reccCount = 0;
        int mktCount = 0;

        foreach (var curOwner in allOwners)
        {
            // 4.a Company Invoicing Baseline (legacy lines 16458-16540)
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT cmp_invoice_seq_code, invoice_to, entity_code, invoice_month, charge_percent,
                           total_income_pkr, charged_amt_pkr, charged_amt_usd, status, exchange_rate_code,
                           remarks, Arrears, share_amount, shortcode, ccy, invoice_from, prfown_code,
                           resource_type, project_code, secondary_dev_code, total_usd_cost, invoice_number,
                           exchange_rate, charg_type_code, support_status, interview_code, interview_seq_code
                    FROM dbo.company_invoicing
                    WHERE prfown_code = @own 
                      AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
                cmd.Parameters.Add(new SqlParameter("@own", curOwner));
                cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    int? chgType = reader.IsDBNull(23) ? null : Convert.ToInt32(reader.GetValue(23));
                    if (chgType.HasValue && excludedChargeTypes.Contains(chgType.Value))
                    {
                        continue;
                    }

                    decimal? entCode = reader.IsDBNull(2) ? null : reader.GetDecimal(2);
                    int? prjCode = reader.IsDBNull(18) ? null : reader.GetInt32(18);
                    int? secDev = reader.IsDBNull(19) ? null : reader.GetInt32(19);
                    int invTo = reader.IsDBNull(1) ? 1 : reader.GetInt32(1);

                    var row = new ProfileInvoiceRowDto
                    {
                        EntityCode = entCode,
                        EntityName = entCode.HasValue && entityNames.TryGetValue(entCode.Value, out var ename) ? ename : "—",
                        InvoiceTo = invTo,
                        InvoiceToName = vendorNames.TryGetValue(invTo, out var vname) ? vname : "—",
                        InvoiceMonth = result.MonthYear,
                        ChargePercent = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                        TotalIncomePkr = reader.IsDBNull(5) ? null : reader.GetDecimal(5),
                        ChargedAmtPkr = reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                        ChargedAmtUsd = reader.IsDBNull(7) ? null : reader.GetDecimal(7),
                        Status = reader.IsDBNull(8) ? null : reader.GetString(8).Trim(),
                        ExchangeRateCode = reader.IsDBNull(9) ? null : reader.GetInt32(9),
                        Remarks = reader.IsDBNull(10) ? null : reader.GetString(10).Trim(),
                        Arrears = reader.IsDBNull(11) ? null : reader.GetDecimal(11),
                        ShareAmount = reader.IsDBNull(12) ? null : reader.GetDecimal(12),
                        Shortcode = reader.IsDBNull(13) ? null : reader.GetString(13).Trim(),
                        Ccy = reader.IsDBNull(14) ? null : reader.GetInt32(14),
                        InvoiceFrom = reader.IsDBNull(15) ? null : reader.GetInt32(15),
                        PrfownCode = curOwner,
                        ProfileOwnerName = profileNames.TryGetValue(curOwner, out var pname) ? pname : "—",
                        PrfgrpOwnCode = groupOwnerCode,
                        GroupOwnerName = result.GroupOwnerName,
                        ResourceType = reader.IsDBNull(17) ? null : reader.GetString(17).Trim(),
                        ProjectCode = prjCode,
                        ProjectName = prjCode.HasValue && projectNames.TryGetValue(prjCode.Value, out var prjName) ? prjName : "—",
                        Stack = prjCode.HasValue && projectStacks.TryGetValue(prjCode.Value, out var stkComp) ? stkComp : "",
                        BranchCode = prjCode.HasValue && projectBranches.TryGetValue(prjCode.Value, out var bComp) ? bComp : 0,
                        IsForeign = prjCode.HasValue && projectBranches.TryGetValue(prjCode.Value, out var bCompF) && bCompF == ForeignBranchCode,
                        SecondaryDevCode = secDev,
                        SecondaryDevName = secDev.HasValue && entityNames.TryGetValue(secDev.Value, out var sname) ? sname : "—",
                        TotalUsdCost = reader.IsDBNull(20) ? null : Convert.ToInt32(reader.GetValue(20)),
                        InvoiceNumber = reader.IsDBNull(21) ? null : reader.GetString(21).Trim(),
                        ExchangeRate = reader.IsDBNull(22) ? null : reader.GetDecimal(22),
                        ChargTypeCode = chgType,
                        SupportStatus = reader.IsDBNull(24) ? null : reader.GetString(24).Trim(),
                        InterviewCode = reader.IsDBNull(25) ? null : reader.GetInt32(25),
                        InterviewSeqCode = reader.IsDBNull(26) ? null : reader.GetInt32(26),
                        // SQL confirmed from PB DW dw_comp_inv_check → d_add_profile_company_invoicing.srd
                        Source = "Company Invoicing"
                    };

                    rows.Add(row);

                    compCount++;
                }
            }

            // 4.b Interviews (legacy lines 16565-16718)
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT entity_code, charg_type_code, paid_amount, currency_code, invoice_to,
                           interview_code, interview_seq_code
                    FROM mkt.profile_int_invoicing
                    WHERE prfown_code = @own 
                      AND REPLACE(RTRIM(month_year), '-', '') = @m";
                cmd.Parameters.Add(new SqlParameter("@own", curOwner));
                cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    decimal eCode = reader.IsDBNull(0) ? 0m : reader.GetDecimal(0);
                    int chgCode = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
                    decimal amt = reader.IsDBNull(2) ? 0m : reader.GetDecimal(2);
                    int ccy = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
                    int vend = reader.IsDBNull(4) ? 1 : reader.GetInt32(4);
                    int intCode = reader.IsDBNull(5) ? 0 : reader.GetInt32(5);
                    int intSeq = reader.IsDBNull(6) ? 0 : reader.GetInt32(6);

                    decimal usdCost = 0m;
                    if (ccy == 1 && exchRate > 0)
                    {
                        usdCost = Math.Round(amt / exchRate, 0, MidpointRounding.AwayFromZero);
                    }
                    else if (ccy == 2)
                    {
                        usdCost = amt;
                    }

                    // Matching rule: entity_code + charg_type_code + interview_seq_code
                    var existing = rows.FirstOrDefault(r =>
                        (r.EntityCode ?? 0m) == eCode &&
                        (r.ChargTypeCode ?? 0) == chgCode &&
                        (r.InterviewSeqCode ?? 0) == intSeq);

                    if (existing == null)
                    {
                        var row = new ProfileInvoiceRowDto
                        {
                            InterviewCode = intCode,
                            InterviewSeqCode = intSeq,
                            EntityCode = eCode,
                            EntityName = entityNames.TryGetValue(eCode, out var ename) ? ename : "—",
                            ChargTypeCode = chgCode,
                            ResourceType = "IT",
                            TotalIncomePkr = amt,
                            TotalUsdCost = (int)usdCost,
                            ShareAmount = 0m,
                            ExchangeRate = exchRate,
                            ChargedAmtUsd = usdCost,
                            Ccy = ccy,
                            InvoiceTo = vend,
                            InvoiceToName = vendorNames.TryGetValue(vend, out var vname) ? vname : "—",
                            PrfownCode = curOwner,
                            ProfileOwnerName = profileNames.TryGetValue(curOwner, out var pname) ? pname : "—",
                            PrfgrpOwnCode = groupOwnerCode,
                            GroupOwnerName = result.GroupOwnerName,
                            InvoiceMonth = result.MonthYear,
                            Source = "Interviews"
                        };
                        rows.Add(row);
                        intCount++;
                    }
                }
            }

            // 4.c Recurring Projects (legacy lines 16723-16885)
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT entity_code, charg_type_code, project_code, amount, currency_code,
                           resource_type, invoice_to, interview_code
                    FROM mkt.prof_int_proj_invoicing
                    WHERE Prfown_code = @own 
                      AND REPLACE(RTRIM(month_year), '-', '') = @m";
                cmd.Parameters.Add(new SqlParameter("@own", curOwner));
                cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    decimal eCode = reader.IsDBNull(0) ? 0m : reader.GetDecimal(0);
                    int chgCode = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
                    int prjCode = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
                    decimal amt = reader.IsDBNull(3) ? 0m : reader.GetDecimal(3);
                    int ccy = reader.IsDBNull(4) ? 0 : reader.GetInt32(4);
                    string resType = reader.IsDBNull(5) ? string.Empty : reader.GetString(5).Trim().ToUpperInvariant();
                    int vend = reader.IsDBNull(6) ? 1 : reader.GetInt32(6);
                    int? intCode = reader.IsDBNull(7) ? null : reader.GetInt32(7);

                    decimal usdCost = 0m;
                    if (ccy == 1 && exchRate > 0)
                    {
                        usdCost = Math.Round(amt / exchRate, 0, MidpointRounding.AwayFromZero);
                    }
                    else if (ccy == 2)
                    {
                        usdCost = amt;
                    }

                    // Matching rule: entity_code + charg_type_code + project_code
                    var existing = rows.FirstOrDefault(r =>
                        (r.EntityCode ?? 0m) == eCode &&
                        (r.ChargTypeCode ?? 0) == chgCode &&
                        (r.ProjectCode ?? 0) == prjCode);

                    if (existing == null)
                    {
                        var row = new ProfileInvoiceRowDto
                        {
                            InterviewCode = intCode,
                            EntityCode = eCode,
                            EntityName = entityNames.TryGetValue(eCode, out var ename) ? ename : "—",
                            ChargTypeCode = chgCode,
                            ProjectCode = prjCode,
                            ProjectName = projectNames.TryGetValue(prjCode, out var pName) ? pName : "—",
                            Stack = projectStacks.TryGetValue(prjCode, out var stkRec) ? stkRec : "",
                            BranchCode = projectBranches.TryGetValue(prjCode, out var bRec) ? bRec : 0,
                            IsForeign = projectBranches.TryGetValue(prjCode, out var bRecF) && bRecF == ForeignBranchCode,
                            ResourceType = resType,
                            TotalIncomePkr = amt,
                            TotalUsdCost = (int)usdCost,
                            ShareAmount = 0m,
                            ExchangeRate = exchRate,
                            ChargedAmtUsd = usdCost,
                            Ccy = ccy,
                            InvoiceTo = vend,
                            InvoiceToName = vendorNames.TryGetValue(vend, out var vname) ? vname : "—",
                            PrfownCode = curOwner,
                            ProfileOwnerName = profileNames.TryGetValue(curOwner, out var pname) ? pname : "—",
                            PrfgrpOwnCode = groupOwnerCode,
                            GroupOwnerName = result.GroupOwnerName,
                            InvoiceMonth = result.MonthYear,
                            Source = "Recurring Projects"
                        };
                        rows.Add(row);
                        reccCount++;
                    }
                }
            }

            // 4.d Marketing Charges (legacy lines 16898-17042)
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT entity_code, charg_type_code, amount, currency_code, invoice_to, active
                    FROM mkt.marketing_chargs
                    WHERE prfown_code = @own";
                cmd.Parameters.Add(new SqlParameter("@own", curOwner));

                using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    string active = reader.IsDBNull(5) ? string.Empty : reader.GetString(5).Trim().ToUpperInvariant();
                    if (active != "Y")
                    {
                        continue;
                    }

                    decimal eCode = reader.IsDBNull(0) ? 0m : reader.GetDecimal(0);
                    int chgCode = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
                    decimal amt = reader.IsDBNull(2) ? 0m : reader.GetDecimal(2);
                    int ccy = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
                    int vend = reader.IsDBNull(4) ? 1 : reader.GetInt32(4);

                    decimal usdCost = 0m;
                    if (ccy == 1 && exchRate > 0)
                    {
                        usdCost = Math.Round(amt / exchRate, 0, MidpointRounding.AwayFromZero);
                    }
                    else if (ccy == 2)
                    {
                        usdCost = amt;
                    }

                    // Matching rule: prfown_code + entity_code + charg_type_code + resource_type == 'MK'
                    var existing = rows.FirstOrDefault(r =>
                        (r.PrfownCode ?? 0) == curOwner &&
                        (r.EntityCode ?? 0m) == eCode &&
                        (r.ChargTypeCode ?? 0) == chgCode &&
                        r.ResourceType == "MK");

                    if (existing == null)
                    {
                        var row = new ProfileInvoiceRowDto
                        {
                            EntityCode = eCode,
                            EntityName = entityNames.TryGetValue(eCode, out var ename) ? ename : "—",
                            ChargTypeCode = chgCode,
                            ResourceType = "MK",
                            TotalIncomePkr = amt,
                            TotalUsdCost = (int)usdCost,
                            ShareAmount = 0m,
                            ExchangeRate = exchRate,
                            ChargedAmtUsd = usdCost,
                            Ccy = ccy,
                            InvoiceTo = vend,
                            InvoiceToName = vendorNames.TryGetValue(vend, out var vname) ? vname : "—",
                            PrfownCode = curOwner,
                            ProfileOwnerName = profileNames.TryGetValue(curOwner, out var pname) ? pname : "—",
                            PrfgrpOwnCode = groupOwnerCode,
                            GroupOwnerName = result.GroupOwnerName,
                            InvoiceMonth = result.MonthYear,
                            Source = "Marketing Charges"
                        };
                        rows.Add(row);
                        mktCount++;
                    }
                }
            }
        }

        result.CountsBySource["Company Invoicing"] = compCount;
        result.CountsBySource["Interviews"] = intCount;
        result.CountsBySource["Recurring Projects"] = reccCount;
        result.CountsBySource["Marketing Charges"] = mktCount;
        result.CountsBySource["Total"] = rows.Count;

        // Resolve executive status from mkt.Projects.profile_type='E' or prof.Profile_Owners.Profile_type='E'
        var projectProfileTypes = new Dictionary<int, string>();
        var ownerProfileTypes = new Dictionary<int, string>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT project_code, ISNULL(profile_type, '') FROM mkt.Projects";
            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                projectProfileTypes[rdr.GetInt32(0)] = rdr.GetString(1).Trim().ToUpperInvariant();
            }
        }
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT PrfOwn_code, ISNULL(Profile_type, '') FROM prof.Profile_Owners";
            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                ownerProfileTypes[rdr.GetInt32(0)] = rdr.GetString(1).Trim().ToUpperInvariant();
            }
        }

        foreach (var r in rows)
        {
            bool isExec = (r.ProjectCode.HasValue && projectProfileTypes.TryGetValue(r.ProjectCode.Value, out var pt) && pt == "E")
                       || (r.PrfownCode.HasValue && ownerProfileTypes.TryGetValue(r.PrfownCode.Value, out var ot) && ot == "E");
            r.IsExecutive = isExec;
            r.IsIncluded = true; // All rows default checked (true) matching PB
        }

        // Use total_usd_cost (PB's "Total Cost" measure) — NOT charged_amt_usd.
        // This aligns dry-run with compare-mode and with the PB cb_8 source.
        // Sort matching PB legacy sort order (w_invoicing_generation lines 13149, 14191, 15237):
        // "prfown_code A, project_code A, interview_code A, charg_type_code A"
        rows = rows
            .OrderBy(r => r.PrfownCode ?? 0)
            .ThenBy(r => r.ProjectCode ?? 0)
            .ThenBy(r => r.InterviewCode ?? 0)
            .ThenBy(r => r.ChargTypeCode ?? 0)
            .ToList();

        await PopulateServiceHeadNamesAsync(conn, rows, ct);

        result.Rows = rows;
        // TotalUsdSum: Matches PowerBuilder's Total Inv. Amount = SUM(charged_amt_usd) = $25,776.00
        result.TotalUsdSum = Math.Round(rows.Sum(r => r.ChargedAmtUsd ?? 0m), 2, MidpointRounding.AwayFromZero);
        // TotalUsdCostSum: Matches PowerBuilder's $ Equivalent = SUM(total_usd_cost) = $21,180.00
        result.TotalUsdCostSum = Math.Round(rows.Sum(r => (decimal)(r.TotalUsdCost ?? 0)), 2, MidpointRounding.AwayFromZero);
        // TotalShareAmountSum: Matches PowerBuilder's Rizviz Share Amount = SUM(share_amount) = $4,596.00
        result.TotalShareAmountSum = Math.Round(rows.Sum(r => r.ShareAmount ?? 0m), 2, MidpointRounding.AwayFromZero);
        // TotalArrearsSum: Matches PowerBuilder's Arrears = SUM(Arrears) = $0.00
        result.TotalArrearsSum = Math.Round(rows.Sum(r => r.Arrears ?? 0m), 2, MidpointRounding.AwayFromZero);
        // TotalPkrSum: Matches PowerBuilder's Project Cost PKR = SUM(total_income_pkr) = Rs 4,234,549
        result.TotalPkrSum = Math.Round(rows.Sum(r => r.TotalIncomePkr ?? 0m), 2, MidpointRounding.AwayFromZero);

        return result;
    }

    // -------------------------------------------------------------------------
    // STAGE 2: Save / Post
    // -------------------------------------------------------------------------

    /// <inheritdoc/>
    public async Task<ProfileInvoiceSaveResult> SaveAsync(
        ProfileInvoiceSaveRequest request,
        CancellationToken ct = default)
    {
        if (request is null) throw new ArgumentNullException(nameof(request));
        if (request.GroupOwnerCode <= 0)
            throw new ArgumentException("Valid GroupOwnerCode required.", nameof(request));
        if (string.IsNullOrWhiteSpace(request.MonthYear))
            throw new ArgumentException("MonthYear required.", nameof(request));
        if (string.IsNullOrWhiteSpace(request.InsertedBy))
            throw new ArgumentException("InsertedBy required.", nameof(request));

        var monthYear = request.MonthYear.Trim().ToUpperInvariant();

        // ── Step 1: Server-side recalculate (dry-run, no bypass of duplicate guard) ──
        // NOTE: we call the internal core directly so we bypass the duplicate guard
        // (the guard is for the UI "Calculate" path; here we need the rows even if
        // they haven't been posted yet — the real guard is the unique index / applock).
        var dryRun = await CalculateDryRunAsync_Internal(request.GroupOwnerCode, monthYear, ct);

        var saveResult = new ProfileInvoiceSaveResult
        {
            GroupOwnerCode = request.GroupOwnerCode,
            GroupOwnerName = dryRun.GroupOwnerName,
            MonthYear = monthYear,
        };

        if (dryRun.Rows.Count == 0)
        {
            saveResult.Success = false;
            saveResult.ErrorMessage = "No rows calculated for this Group Owner and Month. Nothing to save.";
            return saveResult;
        }

        var conn = _db.Database.GetDbConnection() as SqlConnection
            ?? throw new InvalidOperationException("Expected SqlConnection.");

        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        // ── Step 2: Transaction + applock ──────────────────────────────────────
        using var tx = (SqlTransaction)await conn.BeginTransactionAsync(
            IsolationLevel.ReadCommitted, ct);

        try
        {
            // Acquire advisory lock: prevents two simultaneous saves for the same
            // GroupOwner+Month from both succeeding.
            var lockName = $"ProfileInvoice_{request.GroupOwnerCode}_{monthYear}";
            await AcquireApplockAsync(conn, tx, lockName, ct);

            // ── Step 3: Hard duplicate check (inside transaction after applock) ──
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = @"
                    SELECT COUNT(*)
                    FROM dbo.Profile_invoicing
                    WHERE prfgrp_own_code = @grp 
                      AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
                cmd.Parameters.Add(new SqlParameter("@grp", request.GroupOwnerCode));
                cmd.Parameters.Add(new SqlParameter("@m", monthYear.Replace("-", "")));
                var cnt = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
                if (cnt > 0)
                {
                    await tx.RollbackAsync(ct);
                    saveResult.Success = false;
                    saveResult.ErrorMessage =
                        $"Invoices already exist for Group Owner {request.GroupOwnerCode} / {monthYear} ({cnt} rows). Save is blocked.";
                    return saveResult;
                }
            }

            // ── Step 4: Insert all rows, obtaining a fresh PCOM code per row ──
            var now = DateTime.UtcNow;
            var savedRows = new List<ProfileInvoiceSavedRowDto>(dryRun.Rows.Count);
            long firstPcom = 0, lastPcom = 0;

            // Self-healing: Ensure NumberControl.LastNo is at least MAX(cmp_prof_invoice_code)
            using (var syncCmd = conn.CreateCommand())
            {
                syncCmd.Transaction = tx;
                syncCmd.CommandText = @"
                    UPDATE NumberControl
                    SET LastNo = (SELECT ISNULL(MAX(cmp_prof_invoice_code), 0) FROM dbo.Profile_invoicing)
                    WHERE StageName = 'PCOM' AND LastNo < (SELECT ISNULL(MAX(cmp_prof_invoice_code), 0) FROM dbo.Profile_invoicing)";
                await syncCmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var row in dryRun.Rows)
            {
                // Allocate sequence number via stored proc (its own internal tran+rowlock)
                long pcomCode = await GetNextPcomAsync(conn, tx, ct);

                if (firstPcom == 0) firstPcom = pcomCode;
                lastPcom = pcomCode;

                using var insert = conn.CreateCommand();
                insert.Transaction = tx;
                insert.CommandText = @"
                    INSERT INTO dbo.Profile_invoicing
                    (
                        cmp_prof_invoice_code, entity_code, invoice_to, invoice_month,
                        charge_percent, total_income_pkr, charged_amt_pkr, charged_amt_usd,
                        exchange_rate_code, status, remarks,
                        insert_by, insert_time, posted_dt,
                        Arrears, shortcode, share_amount, ccy, invoice_from,
                        prfown_code, prfgrp_own_code, resource_type,
                        project_code, secondary_dev_code, total_usd_cost,
                        invoice_number, exchange_rate, charg_type_code,
                        support_status, interview_code, interview_seq_code,
                        month_days, pro_rate_days, is_included,
                        to_be_discussed, is_processed
                    )
                    VALUES
                    (
                        @pcom, @entity, @invTo, @month,
                        @chgPct, @pkr, @chgPkr, @usd,
                        @exRateCode, 'P', @remarks,
                        @insertBy, @insertTime, @postedDt,
                        @arrears, @shortcode, @share, @ccy, @invFrom,
                        @prfown, @prfgrp, @resType,
                        @prjCode, @secDev, @totalUsd,
                        @invNum, @exRate, @chgType,
                        @suppSts, @intCode, @intSeq,
                        @monthDays, @proRateDays, @isIncluded,
                        0, 0
                    )";

                insert.Parameters.Add(Param("@pcom",       pcomCode));
                insert.Parameters.Add(ParamOrNull("@entity",      row.EntityCode));
                insert.Parameters.Add(Param("@invTo",      (object?)row.InvoiceTo ?? DBNull.Value));
                insert.Parameters.Add(Param("@month",      monthYear));
                insert.Parameters.Add(ParamOrNull("@chgPct",      row.ChargePercent));
                insert.Parameters.Add(ParamOrNull("@pkr",         row.TotalIncomePkr));
                insert.Parameters.Add(ParamOrNull("@chgPkr",      row.ChargedAmtPkr));
                insert.Parameters.Add(ParamOrNull("@usd",         row.ChargedAmtUsd));
                insert.Parameters.Add(ParamOrNull("@exRateCode",  row.ExchangeRateCode));
                insert.Parameters.Add(ParamOrNull("@remarks",     row.Remarks, 300));
                insert.Parameters.Add(Param("@insertBy",   request.InsertedBy.Length > 20 ? request.InsertedBy.Substring(0, 20) : request.InsertedBy));
                insert.Parameters.Add(Param("@insertTime", now));
                insert.Parameters.Add(Param("@postedDt",  now));
                insert.Parameters.Add(ParamOrNull("@arrears",     row.Arrears));
                insert.Parameters.Add(ParamOrNull("@shortcode",   row.Shortcode, 30));
                insert.Parameters.Add(ParamOrNull("@share",       row.ShareAmount));
                insert.Parameters.Add(ParamOrNull("@ccy",         row.Ccy));
                insert.Parameters.Add(ParamOrNull("@invFrom",     row.InvoiceFrom));
                insert.Parameters.Add(ParamOrNull("@prfown",      row.PrfownCode));
                insert.Parameters.Add(Param("@prfgrp",     request.GroupOwnerCode));
                insert.Parameters.Add(ParamOrNull("@resType",     row.ResourceType, 2));
                insert.Parameters.Add(ParamOrNull("@prjCode",     row.ProjectCode));
                insert.Parameters.Add(ParamOrNull("@secDev",      row.SecondaryDevCode));
                insert.Parameters.Add(ParamOrNull("@totalUsd",    row.TotalUsdCost));
                insert.Parameters.Add(ParamOrNull("@invNum",      row.InvoiceNumber, 10));
                insert.Parameters.Add(ParamOrNull("@exRate",      row.ExchangeRate));
                insert.Parameters.Add(ParamOrNull("@chgType",     row.ChargTypeCode));
                insert.Parameters.Add(ParamOrNull("@suppSts",     row.SupportStatus, 2));
                insert.Parameters.Add(ParamOrNull("@intCode",     row.InterviewCode));
                insert.Parameters.Add(ParamOrNull("@intSeq",      row.InterviewSeqCode));
                insert.Parameters.Add(ParamOrNull("@monthDays",   row.MonthDays));
                insert.Parameters.Add(ParamOrNull("@proRateDays", row.ProRateDays));
                insert.Parameters.Add(Param("@isIncluded",        row.IsIncluded ? 1 : 0));

                await insert.ExecuteNonQueryAsync(ct);

                savedRows.Add(new ProfileInvoiceSavedRowDto
                {
                    CmpProfInvoiceCode = pcomCode,
                    EntityCode         = row.EntityCode,
                    EntityName         = row.EntityName,
                    PrfownCode         = row.PrfownCode,
                    ProfileOwnerName   = row.ProfileOwnerName,
                    ChargTypeCode      = row.ChargTypeCode,
                    ResourceType       = row.ResourceType,
                    TotalIncomePkr     = row.TotalIncomePkr,
                    ChargedAmtUsd      = row.ChargedAmtUsd,
                    ExchangeRate       = row.ExchangeRate,
                    Source             = row.Source,
                    IsIncluded         = row.IsIncluded,
                    IsExecutive        = row.IsExecutive
                });
            }

            await tx.CommitAsync(ct);

            saveResult.Success       = true;
            saveResult.RowsInserted  = savedRows.Count;
            saveResult.FirstPcomCode = firstPcom;
            saveResult.LastPcomCode  = lastPcom;
            saveResult.TotalUsdSum   = Math.Round(savedRows.Sum(r => r.ChargedAmtUsd ?? 0m), 2, MidpointRounding.AwayFromZero);
            saveResult.TotalPkrSum   = Math.Round(savedRows.Sum(r => r.TotalIncomePkr ?? 0m), 2, MidpointRounding.AwayFromZero);
            saveResult.SavedRows     = savedRows;
            return saveResult;
        }
        catch (Exception ex)
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch { /* already rolled back */ }
            saveResult.Success      = false;
            saveResult.ErrorMessage = $"Save failed and was rolled back. Detail: {ex.Message}";
            return saveResult;
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /// <summary>
    /// Internal dry-run that SKIPS the AlreadyExists guard, so SaveAsync can
    /// recalculate rows even when no rows exist yet in Profile_invoicing.
    /// The duplicate check in SaveAsync is done separately inside the transaction.
    /// </summary>
    private async Task<ProfileInvoiceDryRunResult> CalculateDryRunAsync_Internal(
        int groupOwnerCode, string monthYear, CancellationToken ct)
    {
        // Re-use CalculateDryRunAsync with bypassDuplicateGuard: true
        var result = await CalculateDryRunAsync(groupOwnerCode, monthYear, bypassDuplicateGuard: true, ct);
        result.AlreadyExists    = false;
        result.WarningMessage   = null;
        return result;
    }

    /// <summary>
    /// Calls dbo.sp_GetNextNumber for the 'PCOM' stage and returns the new sequence number.
    /// The stored proc runs its own internal transaction with ROWLOCK on NumberControl,
    /// which is the same mechanism legacy PowerBuilder uses.
    /// </summary>
    private static async Task<long> GetNextPcomAsync(SqlConnection conn, SqlTransaction tx, CancellationToken ct)
    {
        using var cmd = new SqlCommand("dbo.sp_GetNextNumber", conn, tx)
        {
            CommandType = CommandType.StoredProcedure
        };
        cmd.Parameters.Add(new SqlParameter("@StageName", "PCOM"));
        var nextNoParam = new SqlParameter("@NextNo", SqlDbType.Decimal)
        {
            Precision  = 38,
            Scale      = 0,
            Direction  = ParameterDirection.Input,
            Value      = 1m
        };
        cmd.Parameters.Add(nextNoParam);

        using var reader = await cmd.ExecuteReaderAsync(ct);
        long nextNo = 0;
        if (await reader.ReadAsync(ct))
        {
            nextNo = reader.IsDBNull(0) ? 0L : Convert.ToInt64(reader.GetValue(0));
        }
        return nextNo;
    }

    /// <summary>
    /// Acquires a SQL Server application lock for the duration of <paramref name="tx"/>.
    /// Throws if the lock cannot be acquired within 10 seconds.
    /// </summary>
    private static async Task AcquireApplockAsync(
        SqlConnection conn, SqlTransaction tx, string lockName, CancellationToken ct)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction  = tx;
        cmd.CommandText  = @"
            DECLARE @result INT;
            EXEC @result = sp_getapplock
                @Resource        = @lockName,
                @LockMode        = 'Exclusive',
                @LockOwner       = 'Transaction',
                @LockTimeout     = 10000;   -- 10 s
            IF @result < 0
                THROW 50001, 'Could not acquire profile-invoice applock. Concurrent save in progress.', 1;";
        cmd.Parameters.Add(new SqlParameter("@lockName", lockName));
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<List<ProfileInvoiceRowDto>> GetSavedRowsAsync(int groupOwnerCode, string monthYear, CancellationToken ct = default)
    {
        var cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        // Lookups for friendly names
        var profileNames = new Dictionary<int, string>();
        var entityNames = new Dictionary<decimal, string>();
        var projectNames = new Dictionary<int, string>();
        var vendorNames = new Dictionary<int, string>();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT PrfOwn_code, profile_name FROM prof.Profile_Owners";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                profileNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT entity_code, Full_name FROM hrms.entity";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                entityNames[reader.GetDecimal(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        var projectStacks = new Dictionary<int, string>();
        var projectBranches = new Dictionary<int, int>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT p.project_Code, p.Proj_name, ISNULL(st.stack_name, ''), ISNULL(p.branch_code, 0)
                FROM mkt.Projects p
                LEFT JOIN setups.Stacks st ON st.stack_code = p.stack_cde";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int pCode = reader.GetInt32(0);
                projectNames[pCode] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
                projectStacks[pCode] = reader.IsDBNull(2) ? "" : reader.GetString(2).Trim();
                projectBranches[pCode] = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
            }
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT Vend_code, Vend_name FROM setups.vendors";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                vendorNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "—" : reader.GetString(1).Trim();
            }
        }

        var rows = new List<ProfileInvoiceRowDto>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT pi.cmp_prof_invoice_code, pi.entity_code, pi.invoice_to, pi.invoice_month,
                       pi.charge_percent, pi.total_income_pkr, pi.charged_amt_pkr, pi.charged_amt_usd,
                       pi.exchange_rate_code, pi.status, pi.remarks,
                       pi.Arrears, pi.shortcode, pi.share_amount, pi.ccy, pi.invoice_from,
                       pi.prfown_code, pi.prfgrp_own_code, pi.resource_type,
                       pi.project_code, pi.secondary_dev_code, pi.total_usd_cost,
                       pi.invoice_number, pi.exchange_rate, pi.charg_type_code,
                       pi.support_status, pi.interview_code, pi.interview_seq_code,
                       pi.month_days, pi.pro_rate_days,
                       ISNULL(pi.is_included, 1) AS is_included,
                       CASE WHEN ISNULL(p.profile_type,'')='E' OR ISNULL(po.Profile_type,'')='E' THEN 1 ELSE 0 END AS is_executive
                FROM dbo.Profile_invoicing pi
                LEFT JOIN mkt.Projects p ON p.project_code = pi.project_code
                LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfown_code
                WHERE pi.prfgrp_own_code = @grp 
                  AND REPLACE(RTRIM(pi.invoice_month), '-', '') = @m
                ORDER BY pi.cmp_prof_invoice_code ASC";
            cmd.Parameters.Add(new SqlParameter("@grp", groupOwnerCode));
            cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                decimal? entCode = reader.IsDBNull(1) ? null : reader.GetDecimal(1);
                int invTo = reader.IsDBNull(2) ? 1 : reader.GetInt32(2);
                int? pOwn = reader.IsDBNull(16) ? null : reader.GetInt32(16);
                int? pGrp = reader.IsDBNull(17) ? null : reader.GetInt32(17);
                int? prjCode = reader.IsDBNull(19) ? null : reader.GetInt32(19);
                int? secDev = reader.IsDBNull(20) ? null : reader.GetInt32(20);

                var row = new ProfileInvoiceRowDto
                {
                    CmpProfInvoiceCode = reader.IsDBNull(0) ? null : Convert.ToInt32(reader.GetValue(0)),
                    EntityCode = entCode,
                    EntityName = entCode.HasValue && entityNames.TryGetValue(entCode.Value, out var ename) ? ename : "—",
                    InvoiceTo = invTo,
                    InvoiceToName = vendorNames.TryGetValue(invTo, out var vname) ? vname : "—",
                    InvoiceMonth = reader.IsDBNull(3) ? cleanMonth : reader.GetString(3).Trim(),
                    ChargePercent = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                    TotalIncomePkr = reader.IsDBNull(5) ? null : reader.GetDecimal(5),
                    ChargedAmtPkr = reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                    ChargedAmtUsd = reader.IsDBNull(7) ? null : reader.GetDecimal(7),
                    ExchangeRateCode = reader.IsDBNull(8) ? null : reader.GetInt32(8),
                    Status = reader.IsDBNull(9) ? null : reader.GetString(9).Trim(),
                    Remarks = reader.IsDBNull(10) ? null : reader.GetString(10).Trim(),
                    Arrears = reader.IsDBNull(11) ? null : reader.GetDecimal(11),
                    Shortcode = reader.IsDBNull(12) ? null : reader.GetString(12).Trim(),
                    ShareAmount = reader.IsDBNull(13) ? null : reader.GetDecimal(13),
                    Ccy = reader.IsDBNull(14) ? null : reader.GetInt32(14),
                    InvoiceFrom = reader.IsDBNull(15) ? null : reader.GetInt32(15),
                    PrfownCode = pOwn,
                    ProfileOwnerName = pOwn.HasValue && profileNames.TryGetValue(pOwn.Value, out var pname) ? pname : "—",
                    PrfgrpOwnCode = pGrp,
                    GroupOwnerName = pGrp.HasValue && profileNames.TryGetValue(pGrp.Value, out var gname) ? gname : "—",
                    ResourceType = reader.IsDBNull(18) ? null : reader.GetString(18).Trim(),
                    ProjectCode = prjCode,
                    ProjectName = prjCode.HasValue && projectNames.TryGetValue(prjCode.Value, out var projName) ? projName : "—",
                    Stack = prjCode.HasValue && projectStacks.TryGetValue(prjCode.Value, out var stkSaved) ? stkSaved : "",
                    BranchCode = prjCode.HasValue && projectBranches.TryGetValue(prjCode.Value, out var bSaved) ? bSaved : 0,
                    IsForeign = prjCode.HasValue && projectBranches.TryGetValue(prjCode.Value, out var bSavedF) && bSavedF == ForeignBranchCode,
                    SecondaryDevCode = secDev,
                    SecondaryDevName = secDev.HasValue && entityNames.TryGetValue(secDev.Value, out var sname) ? sname : "—",
                    TotalUsdCost = reader.IsDBNull(21) ? null : Convert.ToInt32(reader.GetValue(21)),
                    InvoiceNumber = reader.IsDBNull(22) ? null : reader.GetString(22).Trim(),
                    ExchangeRate = reader.IsDBNull(23) ? null : reader.GetDecimal(23),
                    ChargTypeCode = reader.IsDBNull(24) ? null : reader.GetInt32(24),
                    SupportStatus = reader.IsDBNull(25) ? null : reader.GetString(25).Trim(),
                    InterviewCode = reader.IsDBNull(26) ? null : reader.GetInt32(26),
                    InterviewSeqCode = reader.IsDBNull(27) ? null : reader.GetInt32(27),
                    MonthDays = reader.IsDBNull(28) ? null : reader.GetInt32(28),
                    ProRateDays = reader.IsDBNull(29) ? null : reader.GetInt32(29),
                    IsIncluded = Convert.ToBoolean(reader.GetValue(30)),
                    IsExecutive = Convert.ToInt32(reader.GetValue(31)) == 1,
                    Source = "Saved"
                };

                rows.Add(row);
            }
        }

        await PopulateServiceHeadNamesAsync(conn, rows, ct);
        return rows;
    }

    private static async Task PopulateServiceHeadNamesAsync(
        DbConnection conn,
        List<ProfileInvoiceRowDto> rows,
        CancellationToken ct)
    {
        var chargTypeCodes = rows
            .Where(r => r.ChargTypeCode.HasValue && r.ChargTypeCode.Value > 0)
            .Select(r => r.ChargTypeCode!.Value)
            .Distinct()
            .ToList();

        var chargibilityNames = new Dictionary<int, string>();
        if (chargTypeCodes.Count > 0)
        {
            using var chCmd = conn.CreateCommand();
            chCmd.CommandText = $"SELECT charg_type_code, resource_nature FROM setups.Chargibility WHERE charg_type_code IN ({string.Join(",", chargTypeCodes)})";
            using var chReader = await chCmd.ExecuteReaderAsync(ct);
            while (await chReader.ReadAsync(ct))
            {
                int cCode = chReader.GetInt32(0);
                string nature = chReader.IsDBNull(1) ? "" : chReader.GetString(1).Trim();
                if (!chargibilityNames.ContainsKey(cCode))
                    chargibilityNames[cCode] = nature;
            }
        }

        foreach (var row in rows)
        {
            string resType = row.ResourceType?.Trim().ToUpperInvariant() ?? "";
            string serviceHead = resType switch
            {
                "JH" => "Job Holder",
                "SP" => "Support Provider",
                "SL" => "Special",
                "DR" => "Second Resource",
                "BB" => "BD-Commission",
                "BE" => "BD Recurr. Comm. - EXE",
                "BR" => "BD Recurr. Comm. - REG",
                "I1" => "Interview Commission - 1st",
                "J1" => "Interview Commission - 2nd",
                "X1" => "DEV Recurr. Comm.",
                "TZ" => "TimeZone Allowance",
                "BO" => "Bonus",
                "TL" => "TL-Allounce",
                "BS" => "DEV/Marketing",
                "IT" => "Interview",
                "OE" => "",
                _   => ""
            };

            if (string.IsNullOrEmpty(serviceHead) && row.ChargTypeCode.HasValue
                && chargibilityNames.TryGetValue(row.ChargTypeCode.Value, out var cName))
            {
                serviceHead = cName;
            }

            // Fallback: show raw resource_type code if still empty
            row.ServiceHeadName = string.IsNullOrEmpty(serviceHead) ? resType : serviceHead;
        }
    }

    public async Task<bool> IsMonthFinalizedAsync(string monthYear, CancellationToken ct = default)
    {
        string cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();
        if (string.IsNullOrEmpty(cleanMonth)) return false;

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.final_invoicing WHERE REPLACE(RTRIM(month_year), '-', '') = @m) THEN 1 ELSE 0 END";
        cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));
        var res = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt32(res ?? 0) == 1;
    }

    public async Task<ProfileInvoiceRowUpdateResponse> UpdateRowAsync(
        long cmpProfInvoiceCode, ProfileInvoiceRowUpdateRequest request, string username, CancellationToken ct = default)
    {
        var response = new ProfileInvoiceRowUpdateResponse();
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        // 1. Fetch current row state
        string invoiceMonth = "";
        int grpOwnerCode = 0;
        decimal currIncome = 0m;
        decimal currChgPkr = 0m;
        decimal currChgUsd = 0m;
        decimal currRate = 0m;
        decimal currPct = 0m;
        int currCcy = 1;
        bool currIsIncludedBool = true;
        decimal currArrears = 0m;
        decimal currShare = 0m;
        decimal currCost = 0m;
        int? currProjCode = null;
        int currProDays = 0;
        int currMonthDays = 0;
        string currRemarks = "";
        string currStatus = "P";
        string currInvNum = "";
        bool exists = false;

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT invoice_month, prfgrp_own_code, ISNULL(total_income_pkr, 0),
                       ISNULL(charged_amt_pkr, 0), ISNULL(charged_amt_usd, 0),
                       ISNULL(exchange_rate, 0), ISNULL(charge_percent, 0), ISNULL(ccy, 1),
                       ISNULL(is_included, 1), ISNULL(arrears, 0), ISNULL(share_amount, 0),
                       ISNULL(total_usd_cost, 0), project_code, ISNULL(pro_rate_days, 0), ISNULL(month_days, 0),
                       ISNULL(remarks, ''), ISNULL(status, 'P'), ISNULL(invoice_number, '')
                FROM dbo.Profile_invoicing
                WHERE cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(Param("@code", cmpProfInvoiceCode));
            using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                exists = true;
                invoiceMonth = reader.GetString(0).Trim();
                grpOwnerCode = reader.GetInt32(1);
                currIncome   = reader.GetDecimal(2);
                currChgPkr   = reader.GetDecimal(3);
                currChgUsd   = reader.GetDecimal(4);
                currRate     = reader.GetDecimal(5);
                currPct      = reader.GetDecimal(6);
                currCcy      = reader.GetInt32(7);
                currIsIncludedBool = reader.GetBoolean(8);
                currArrears  = reader.GetDecimal(9);
                currShare    = reader.GetDecimal(10);
                currCost     = reader.IsDBNull(11) ? 0m : Convert.ToDecimal(reader.GetValue(11));
                currProjCode = reader.IsDBNull(12) ? null : reader.GetInt32(12);
                currProDays  = reader.GetInt32(13);
                currMonthDays= reader.GetInt32(14);
                currRemarks  = reader.GetString(15);
                currStatus   = reader.GetString(16);
                currInvNum   = reader.GetString(17);
            }
        }

        if (!exists)
        {
            response.Success = false;
            response.Message = $"Invoice row #{cmpProfInvoiceCode} not found.";
            return response;
        }

        decimal? currProjRate = null;
        string currProjSalaryRate = "";
        if (currProjCode.HasValue && currProjCode.Value > 0)
        {
            using var cmdP = conn.CreateCommand();
            cmdP.CommandText = "SELECT ISNULL(proj_rate, 0), ISNULL(salary_rate, '') FROM mkt.Projects WHERE project_code = @p";
            cmdP.Parameters.Add(Param("@p", currProjCode.Value));
            using var rdrP = await cmdP.ExecuteReaderAsync(ct);
            if (await rdrP.ReadAsync(ct))
            {
                currProjRate = rdrP.GetDecimal(0);
                currProjSalaryRate = rdrP.GetString(1);
            }
        }

        bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

        // 3. Validation
        if (request.TotalIncomePkr.HasValue && request.TotalIncomePkr.Value < 0)
        {
            response.Success = false;
            response.Message = "Total income PKR cannot be negative.";
            return response;
        }
        if (request.ChargePercent.HasValue && (request.ChargePercent.Value < 0 || request.ChargePercent.Value > 100))
        {
            response.Success = false;
            response.Message = "Charge percent must be between 0 and 100.";
            return response;
        }
        if (request.ExchangeRate.HasValue && request.ExchangeRate.Value < 0)
        {
            response.Success = false;
            response.Message = "Exchange rate cannot be negative.";
            return response;
        }
        if (request.Arrears.HasValue && request.Arrears.Value < 0)
        {
            response.Success = false;
            response.Message = "Arrears cannot be negative.";
            return response;
        }
        if (request.ShareAmount.HasValue && request.ShareAmount.Value < 0)
        {
            response.Success = false;
            response.Message = "Share amount cannot be negative.";
            return response;
        }
        if (request.AgreedRate.HasValue && request.AgreedRate.Value < 0)
        {
            response.Success = false;
            response.Message = "Project rate cannot be negative.";
            return response;
        }

        // 4. Recalculate amounts if relevant fields changed
        decimal newIncome = request.TotalIncomePkr ?? currIncome;
        decimal newPct    = request.ChargePercent ?? currPct;
        decimal newRate   = request.ExchangeRate ?? currRate;

        decimal newChgPkr = currChgPkr;
        decimal newChgUsd = currChgUsd;
        decimal? newTotalCost = request.TotalCost;

        if (request.ChargedAmtUsd.HasValue)
        {
            decimal val = Math.Round(request.ChargedAmtUsd.Value, 0, MidpointRounding.AwayFromZero);
            newTotalCost ??= val;
            decimal share = request.ShareAmount ?? currShare;
            newChgUsd = val + share;
            if (newRate > 0)
            {
                newChgPkr = Math.Round(newChgUsd * newRate, 2, MidpointRounding.AwayFromZero);
            }
        }
        else if (request.TotalCost.HasValue)
        {
            decimal val = Math.Round(request.TotalCost.Value, 0, MidpointRounding.AwayFromZero);
            newTotalCost = val;
            decimal share = request.ShareAmount ?? currShare;
            newChgUsd = val + share;
            if (newRate > 0)
            {
                newChgPkr = Math.Round(newChgUsd * newRate, 2, MidpointRounding.AwayFromZero);
            }
        }
        else if (request.TotalIncomePkr.HasValue || request.ChargePercent.HasValue || request.ExchangeRate.HasValue)
        {
            if (newPct > 0)
            {
                newChgPkr = Math.Round((newIncome * newPct) / 100m, 2, MidpointRounding.AwayFromZero);
            }
            else
            {
                newChgPkr = newIncome;
            }

            if (currCcy == 2)
            {
                newChgUsd = newIncome;
            }
            else if (newRate > 0)
            {
                newChgUsd = Math.Round(newChgPkr / newRate, 0, MidpointRounding.AwayFromZero);
            }
            decimal share = request.ShareAmount ?? currShare;
            newTotalCost = Math.Max(0, newChgUsd - share);
        }

        // 5. Update row in DB within a transaction
        using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = (DbTransaction)tx;
                cmd.CommandText = @"
                    UPDATE dbo.Profile_invoicing
                    SET invoice_number = COALESCE(@invNum, invoice_number),
                        remarks = COALESCE(@remarks, remarks),
                        status = COALESCE(@status, status),
                        total_income_pkr = COALESCE(@income, total_income_pkr),
                        charge_percent = COALESCE(@pct, charge_percent),
                        exchange_rate = COALESCE(@rate, exchange_rate),
                        arrears = COALESCE(@arrears, arrears),
                        share_amount = COALESCE(@share, share_amount),
                        total_usd_cost = COALESCE(@cost, total_usd_cost),
                        pro_rate_days = COALESCE(@proDays, pro_rate_days),
                        month_days = COALESCE(@monthDays, month_days),
                        charged_amt_pkr = @chgPkr,
                        charged_amt_usd = @chgUsd,
                        is_included = COALESCE(@isInc, is_included),
                        last_modified_by = @user,
                        last_modified_time = GETDATE()
                    WHERE cmp_prof_invoice_code = @code";

                cmd.Parameters.Add(ParamOrNull("@invNum", request.InvoiceNumber, 10));
                cmd.Parameters.Add(ParamOrNull("@remarks", request.Remarks, 300));
                cmd.Parameters.Add(ParamOrNull("@status", request.Status, 1));
                cmd.Parameters.Add(ParamOrNull("@income", request.TotalIncomePkr));
                cmd.Parameters.Add(ParamOrNull("@pct", request.ChargePercent));
                cmd.Parameters.Add(ParamOrNull("@rate", request.ExchangeRate));
                cmd.Parameters.Add(ParamOrNull("@arrears", request.Arrears));
                cmd.Parameters.Add(ParamOrNull("@share", request.ShareAmount));
                cmd.Parameters.Add(ParamOrNull("@cost", newTotalCost));
                cmd.Parameters.Add(ParamOrNull("@proDays", request.ProRateDays));
                cmd.Parameters.Add(ParamOrNull("@monthDays", request.MonthDays));
                cmd.Parameters.Add(Param("@chgPkr", newChgPkr));
                cmd.Parameters.Add(Param("@chgUsd", newChgUsd));
                cmd.Parameters.Add(ParamOrNull("@isInc", request.IsIncluded));
                cmd.Parameters.Add(Param("@user", string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username)));
                cmd.Parameters.Add(Param("@code", cmpProfInvoiceCode));

                await cmd.ExecuteNonQueryAsync(ct);
            }

            // Project rate update if applicable
            if (request.AgreedRate.HasValue && currProjCode.HasValue && currProjCode.Value > 0)
            {
                using var cmdProj = conn.CreateCommand();
                cmdProj.Transaction = (DbTransaction)tx;
                cmdProj.CommandText = "UPDATE mkt.Projects SET proj_rate = @pr WHERE project_code = @p";
                cmdProj.Parameters.Add(Param("@pr", request.AgreedRate.Value));
                cmdProj.Parameters.Add(Param("@p", currProjCode.Value));
                await cmdProj.ExecuteNonQueryAsync(ct);
            }
            if (request.SalaryRate != null && currProjCode.HasValue && currProjCode.Value > 0)
            {
                using var cmdProj = conn.CreateCommand();
                cmdProj.Transaction = (DbTransaction)tx;
                cmdProj.CommandText = "UPDATE mkt.Projects SET salary_rate = @sr WHERE project_code = @p";
                cmdProj.Parameters.Add(ParamOrNull("@sr", request.SalaryRate, 50));
                cmdProj.Parameters.Add(Param("@p", currProjCode.Value));
                await cmdProj.ExecuteNonQueryAsync(ct);
            }
            if ((request.ProRateDays.HasValue || request.MonthDays.HasValue) && currProjCode.HasValue && currProjCode.Value > 0)
            {
                using var cmdPIn = conn.CreateCommand();
                cmdPIn.Transaction = (DbTransaction)tx;
                cmdPIn.CommandText = @"UPDATE mkt.project_invoicing 
                                      SET pro_rate_days = COALESCE(@pro, pro_rate_days),
                                          month_days = COALESCE(@mon, month_days)
                                      WHERE project_code = @p AND REPLACE(RTRIM(month_year), '-', '') = @m";
                cmdPIn.Parameters.Add(ParamOrNull("@pro", request.ProRateDays));
                cmdPIn.Parameters.Add(ParamOrNull("@mon", request.MonthDays));
                cmdPIn.Parameters.Add(Param("@p", currProjCode.Value));
                cmdPIn.Parameters.Add(Param("@m", invoiceMonth.Replace("-", "").ToUpperInvariant()));
                await cmdPIn.ExecuteNonQueryAsync(ct);
            }

            // 5b. Save audit log for each modified field into dbo.profile_invoice_audit_log
            var auditLogs = new List<(string Field, string? OldVal, string? NewVal)>();

            if (request.IsIncluded.HasValue && request.IsIncluded.Value != currIsIncludedBool)
            {
                auditLogs.Add(("is_included", currIsIncludedBool ? "1" : "0", request.IsIncluded.Value ? "1" : "0"));
            }
            if (request.ChargedAmtUsd.HasValue && newChgUsd != currChgUsd)
            {
                auditLogs.Add(("charged_amt_usd", currChgUsd.ToString("0.##"), newChgUsd.ToString("0.##")));
            }
            if (request.TotalIncomePkr.HasValue && newIncome != currIncome)
            {
                auditLogs.Add(("total_income_pkr", currIncome.ToString("0.##"), newIncome.ToString("0.##")));
            }
            if (request.ExchangeRate.HasValue && newRate != currRate)
            {
                auditLogs.Add(("exchange_rate", currRate.ToString("0.##"), newRate.ToString("0.##")));
            }
            if (request.ChargePercent.HasValue && newPct != currPct)
            {
                auditLogs.Add(("charge_percent", currPct.ToString("0.##"), newPct.ToString("0.##")));
            }
            if (request.Arrears.HasValue && request.Arrears.Value != currArrears)
            {
                auditLogs.Add(("arrears", currArrears.ToString("0.##"), request.Arrears.Value.ToString("0.##")));
            }
            if (request.ShareAmount.HasValue && request.ShareAmount.Value != currShare)
            {
                auditLogs.Add(("share_amount", currShare.ToString("0.##"), request.ShareAmount.Value.ToString("0.##")));
            }
            if (newTotalCost.HasValue && newTotalCost.Value != currCost)
            {
                auditLogs.Add(("total_usd_cost", currCost.ToString("0.##"), newTotalCost.Value.ToString("0.##")));
            }
            if (request.Remarks != null && request.Remarks.Trim() != currRemarks.Trim())
            {
                auditLogs.Add(("remarks", currRemarks.Trim(), request.Remarks.Trim()));
            }
            if (request.AgreedRate.HasValue && currProjRate.HasValue && request.AgreedRate.Value != currProjRate.Value)
            {
                auditLogs.Add(("agreed_rate", currProjRate.Value.ToString("0.##"), request.AgreedRate.Value.ToString("0.##")));
            }
            if (request.SalaryRate != null && request.SalaryRate.Trim() != currProjSalaryRate.Trim())
            {
                auditLogs.Add(("salary_rate", currProjSalaryRate.Trim(), request.SalaryRate.Trim()));
            }
            if (request.ProRateDays.HasValue && request.ProRateDays.Value != currProDays)
            {
                auditLogs.Add(("pro_rate_days", currProDays.ToString(), request.ProRateDays.Value.ToString()));
            }
            if (request.MonthDays.HasValue && request.MonthDays.Value != currMonthDays)
            {
                auditLogs.Add(("month_days", currMonthDays.ToString(), request.MonthDays.Value.ToString()));
            }
            if (request.Status != null && request.Status.Trim() != currStatus.Trim())
            {
                auditLogs.Add(("status", currStatus.Trim(), request.Status.Trim()));
            }
            if (request.InvoiceNumber != null && request.InvoiceNumber.Trim() != currInvNum.Trim())
            {
                auditLogs.Add(("invoice_number", currInvNum.Trim(), request.InvoiceNumber.Trim()));
            }

            if (auditLogs.Count > 0)
            {
                string userLog = string.IsNullOrWhiteSpace(username) ? "System" : username.Trim();
                foreach (var log in auditLogs)
                {
                    using var cmdAudit = conn.CreateCommand();
                    cmdAudit.Transaction = (DbTransaction)tx;
                    cmdAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @code, @field, @old, @new, @isFinalized)";
                    cmdAudit.Parameters.Add(Param("@user", userLog));
                    cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
                    cmdAudit.Parameters.Add(Param("@code", cmpProfInvoiceCode));
                    cmdAudit.Parameters.Add(Param("@field", log.Field));
                    cmdAudit.Parameters.Add(ParamOrNull("@old", log.OldVal));
                    cmdAudit.Parameters.Add(ParamOrNull("@new", log.NewVal));
                    cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdAudit.ExecuteNonQueryAsync(ct);
                }
            }

            await tx.CommitAsync(ct);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(ct);
            response.Success = false;
            response.Message = $"Database update failed: {ex.Message}";
            return response;
        }

        // 6. Recalculate group totals for this month (only included rows!)
        decimal totalUsd = 0m;
        decimal totalPkr = 0m;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT ISNULL(SUM(charged_amt_usd), 0),
                       ISNULL(SUM(total_income_pkr), 0)
                FROM dbo.Profile_invoicing
                WHERE prfgrp_own_code = @grp 
                  AND REPLACE(RTRIM(invoice_month), '-', '') = @m
                  AND (is_included = 1 OR is_included IS NULL)";
            cmd.Parameters.Add(Param("@grp", grpOwnerCode));
            cmd.Parameters.Add(Param("@m", invoiceMonth.Replace("-", "").ToUpperInvariant()));

            using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                totalUsd = reader.GetDecimal(0);
                totalPkr = reader.GetDecimal(1);
            }
        }

        // 7. Get the updated row
        var updatedRows = await GetSavedRowsAsync(grpOwnerCode, invoiceMonth, ct);
        var updatedRow = updatedRows.FirstOrDefault(r => r.CmpProfInvoiceCode == cmpProfInvoiceCode);

        // 8. Get updated Excel View so all UI totals and row amounts update live in response
        var excelView = await GetExcelViewAsync(grpOwnerCode, invoiceMonth, ct);

        response.Success = true;
        response.UpdatedRow = updatedRow;
        response.TotalUsdSum = totalUsd;
        response.TotalPkrSum = totalPkr;
        response.ExcelView = excelView;
        return response;
    }

    public async Task<ProfileInvoiceRowUpdateResponse> UpdateProjectRowAsync(
        int projectCode, string monthYear, int groupOwnerCode,
        ProfileInvoiceProjectUpdateRequest request, string username, CancellationToken ct = default)
    {
        var response = new ProfileInvoiceRowUpdateResponse();
        if (projectCode <= 0)
        {
            response.Success = false;
            response.Message = "Valid projectCode is required.";
            return response;
        }

        if (request == null)
        {
            response.Success = false;
            response.Message = "Request body is required.";
            return response;
        }

        if (request.AgreedRate.HasValue && request.AgreedRate.Value < 0)
        {
            response.Success = false;
            response.Message = "Project rate cannot be negative.";
            return response;
        }

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        string cleanMonth = (monthYear ?? "").Trim().Replace("-", "").ToUpperInvariant();
        bool isFinalized = await IsMonthFinalizedAsync(cleanMonth, ct);

        // Fetch current project values & verify project exists
        decimal currRate = 0m;
        string currSalaryRate = "";
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT ISNULL(proj_rate, 0), ISNULL(salary_rate, '') FROM mkt.Projects WHERE project_code = @p";
            cmd.Parameters.Add(Param("@p", projectCode));
            using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                currRate = reader.GetDecimal(0);
                currSalaryRate = reader.GetString(1);
            }
            else
            {
                response.Success = false;
                response.Message = $"Project #{projectCode} not found in database.";
                return response;
            }
        }

        int currProDays = 0;
        int currMonthDays = 0;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"SELECT ISNULL(pro_rate_days, 0), ISNULL(month_days, 0) 
                              FROM mkt.project_invoicing 
                              WHERE project_code = @p AND REPLACE(RTRIM(month_year), '-', '') = @m AND resource_type IN ('JH', 'SL')";
            cmd.Parameters.Add(Param("@p", projectCode));
            cmd.Parameters.Add(Param("@m", cleanMonth));
            using var reader = await cmd.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                currProDays = reader.GetInt32(0);
                currMonthDays = reader.GetInt32(1);
            }
        }

        using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            // Update mkt.Projects if rate changed (matches PowerBuilder: UPDATE mkt.Projects SET proj_rate = :data WHERE project_code = :project_code)
            if (request.AgreedRate.HasValue)
            {
                using var cmd = conn.CreateCommand();
                cmd.Transaction = (DbTransaction)tx;
                cmd.CommandText = @"
                    UPDATE mkt.Projects 
                    SET proj_rate = @rate
                    WHERE project_code = @p";
                cmd.Parameters.Add(Param("@rate", request.AgreedRate.Value));
                cmd.Parameters.Add(Param("@p", projectCode));
                await cmd.ExecuteNonQueryAsync(ct);
            }

            // Update salary rate if changed
            if (request.SalaryRate != null)
            {
                using var cmd = conn.CreateCommand();
                cmd.Transaction = (DbTransaction)tx;
                cmd.CommandText = @"
                    UPDATE mkt.Projects 
                    SET salary_rate = @sal
                    WHERE project_code = @p";
                cmd.Parameters.Add(ParamOrNull("@sal", request.SalaryRate, 50));
                cmd.Parameters.Add(Param("@p", projectCode));
                await cmd.ExecuteNonQueryAsync(ct);
            }

            // Update days if changed
            if (request.ProRateDays.HasValue || request.MonthDays.HasValue)
            {
                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = (DbTransaction)tx;
                    cmd.CommandText = @"
                        UPDATE mkt.project_invoicing 
                        SET pro_rate_days = COALESCE(@pro, pro_rate_days),
                            month_days = COALESCE(@mon, month_days)
                        WHERE project_code = @p AND REPLACE(RTRIM(month_year), '-', '') = @m";
                    cmd.Parameters.Add(ParamOrNull("@pro", request.ProRateDays));
                    cmd.Parameters.Add(ParamOrNull("@mon", request.MonthDays));
                    cmd.Parameters.Add(Param("@p", projectCode));
                    cmd.Parameters.Add(Param("@m", cleanMonth));
                    await cmd.ExecuteNonQueryAsync(ct);
                }

                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = (DbTransaction)tx;
                    cmd.CommandText = @"
                        UPDATE dbo.Profile_invoicing 
                        SET pro_rate_days = COALESCE(@pro, pro_rate_days),
                            month_days = COALESCE(@mon, month_days)
                        WHERE project_code = @p AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
                    cmd.Parameters.Add(ParamOrNull("@pro", request.ProRateDays));
                    cmd.Parameters.Add(ParamOrNull("@mon", request.MonthDays));
                    cmd.Parameters.Add(Param("@p", projectCode));
                    cmd.Parameters.Add(Param("@m", cleanMonth));
                    await cmd.ExecuteNonQueryAsync(ct);
                }
            }

            // Audit log tracking
            var auditLogs = new List<(string Field, string? OldVal, string? NewVal)>();

            // Update Project Name if changed
            if (request.ProjectName != null)
            {
                using var cmd = conn.CreateCommand();
                cmd.Transaction = (DbTransaction)tx;
                cmd.CommandText = @"UPDATE mkt.Projects SET Proj_name = @pname WHERE project_code = @p";
                cmd.Parameters.Add(ParamOrNull("@pname", request.ProjectName, 200));
                cmd.Parameters.Add(Param("@p", projectCode));
                await cmd.ExecuteNonQueryAsync(ct);
            }

            // Update Job Type if changed
            if (request.JobType != null)
            {
                using var cmd = conn.CreateCommand();
                cmd.Transaction = (DbTransaction)tx;
                cmd.CommandText = @"UPDATE mkt.Projects SET job_type = @jtype WHERE project_code = @p";
                cmd.Parameters.Add(ParamOrNull("@jtype", request.JobType, 50));
                cmd.Parameters.Add(Param("@p", projectCode));
                await cmd.ExecuteNonQueryAsync(ct);
            }

            // KAAM 1 Rule 2: Project Header Inc toggle (is_included)
            if (request.IsIncluded.HasValue)
            {
                bool currInc = true;
                using (var cmdCurr = conn.CreateCommand())
                {
                    cmdCurr.Transaction = (DbTransaction)tx;
                    cmdCurr.CommandText = @"
                        SELECT TOP 1 ISNULL(is_included, 1) 
                        FROM dbo.Profile_invoicing
                        WHERE project_code = @p 
                          AND REPLACE(RTRIM(invoice_month), '-', '') = @m
                        ORDER BY CASE WHEN resource_type = 'JH' THEN 1 WHEN resource_type = 'DR' THEN 2 ELSE 3 END";
                    cmdCurr.Parameters.Add(Param("@p", projectCode));
                    cmdCurr.Parameters.Add(Param("@m", cleanMonth));
                    var currIncObj = await cmdCurr.ExecuteScalarAsync(ct);
                    if (currIncObj != null && currIncObj != DBNull.Value)
                    {
                        currInc = Convert.ToBoolean(currIncObj);
                    }
                }

                if (currInc != request.IsIncluded.Value)
                {
                    using var cmdInc = conn.CreateCommand();
                    cmdInc.Transaction = (DbTransaction)tx;
                    cmdInc.CommandText = @"
                        UPDATE dbo.Profile_invoicing
                        SET is_included = @inc
                        WHERE project_code = @p
                          AND REPLACE(RTRIM(invoice_month), '-', '') = @m
                          AND (resource_type IN ('JH', 'DR') OR resource_type IS NULL)";
                    cmdInc.Parameters.Add(Param("@inc", request.IsIncluded.Value ? 1 : 0));
                    cmdInc.Parameters.Add(Param("@p", projectCode));
                    cmdInc.Parameters.Add(Param("@m", cleanMonth));
                    int affected = await cmdInc.ExecuteNonQueryAsync(ct);
                    if (affected == 0)
                    {
                        using var cmdFallback = conn.CreateCommand();
                        cmdFallback.Transaction = (DbTransaction)tx;
                        cmdFallback.CommandText = @"
                            UPDATE dbo.Profile_invoicing
                            SET is_included = @inc
                            WHERE project_code = @p
                              AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
                        cmdFallback.Parameters.Add(Param("@inc", request.IsIncluded.Value ? 1 : 0));
                        cmdFallback.Parameters.Add(Param("@p", projectCode));
                        cmdFallback.Parameters.Add(Param("@m", cleanMonth));
                        await cmdFallback.ExecuteNonQueryAsync(ct);
                    }

                    auditLogs.Add(("is_included", currInc ? "1" : "0", request.IsIncluded.Value ? "1" : "0"));
                }
            }
            if (request.AgreedRate.HasValue && request.AgreedRate.Value != currRate)
            {
                auditLogs.Add(("agreed_rate", currRate.ToString("0.##"), request.AgreedRate.Value.ToString("0.##")));
            }
            if (request.SalaryRate != null && request.SalaryRate != currSalaryRate)
            {
                auditLogs.Add(("salary_rate", currSalaryRate, request.SalaryRate));
            }
            if (request.ProRateDays.HasValue && request.ProRateDays.Value != currProDays)
            {
                auditLogs.Add(("pro_rate_days", currProDays.ToString(), request.ProRateDays.Value.ToString()));
            }
            if (request.MonthDays.HasValue && request.MonthDays.Value != currMonthDays)
            {
                auditLogs.Add(("month_days", currMonthDays.ToString(), request.MonthDays.Value.ToString()));
            }

            if (auditLogs.Count > 0)
            {
                string userLog = string.IsNullOrWhiteSpace(username) ? "System" : username.Trim();
                foreach (var log in auditLogs)
                {
                    using var cmdAudit = conn.CreateCommand();
                    cmdAudit.Transaction = (DbTransaction)tx;
                    cmdAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, project_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @p, @field, @old, @new, @isFinalized)";
                    cmdAudit.Parameters.Add(Param("@user", userLog));
                    cmdAudit.Parameters.Add(Param("@m", cleanMonth));
                    cmdAudit.Parameters.Add(Param("@p", projectCode));
                    cmdAudit.Parameters.Add(Param("@field", log.Field));
                    cmdAudit.Parameters.Add(ParamOrNull("@old", log.OldVal));
                    cmdAudit.Parameters.Add(ParamOrNull("@new", log.NewVal));
                    cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdAudit.ExecuteNonQueryAsync(ct);
                }
            }

            await tx.CommitAsync(ct);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(ct);
            response.Success = false;
            response.Message = $"Database update failed: {ex.Message}";
            return response;
        }

        // Return updated ExcelView (reads committed database values)
        var excelView = await GetExcelViewAsync(groupOwnerCode, cleanMonth, ct);
        response.Success = true;
        response.Message = request.AgreedRate.HasValue
            ? $"Project #{projectCode} Agreed Rate successfully updated to ${request.AgreedRate.Value:N0}."
            : $"Project #{projectCode} details successfully updated.";
        response.ExcelView = excelView;
        return response;
    }

    // PB line 13497: only branch_code = 5 shows branch_name, other branches remain blank
    public const int ForeignBranchCode = 5;

    public Task<ProfileInvoiceExcelViewResult> GetExcelViewAsync(
        int groupOwnerCode, string monthYear, CancellationToken ct = default)
        => GetExcelViewAsync(groupOwnerCode, monthYear, false, null, ct);

    public async Task<ProfileInvoiceExcelViewResult> GetExcelViewAsync(
        int groupOwnerCode, string monthYear, bool processedOnly, int? specificOwnerCode = null, CancellationToken ct = default, bool excludeToBeDiscussed = false)
    {
        string cleanMonth = (monthYear ?? string.Empty).Trim().Replace("-", "").ToUpperInvariant();
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
        {
            await conn.OpenAsync(ct);
        }

        // 1. Resolve Group Owner / Recipient Owner Code and Name
        int effectiveGroupCode = (specificOwnerCode.HasValue && specificOwnerCode.Value > 0)
            ? specificOwnerCode.Value
            : groupOwnerCode;
        string groupOwnerName = "";

        if (processedOnly || (specificOwnerCode.HasValue && specificOwnerCode.Value > 0))
        {
            // For processed / specific recipient, resolve their own profile name directly
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT profile_name FROM prof.Profile_Owners WHERE PrfOwn_code = @grp";
            cmd.Parameters.Add(Param("@grp", effectiveGroupCode));
            var nameObj = await cmd.ExecuteScalarAsync(ct);
            groupOwnerName = nameObj?.ToString()?.Trim() ?? $"Owner #{effectiveGroupCode}";
        }
        else
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT po.profile_name,
                           ISNULL(po.ParentProfile_code, 0) AS parent_code,
                           ISNULL(parent.PrfOwn_code, 0)   AS resolved_grp,
                           ISNULL(parent.profile_name, '')  AS resolved_grp_name
                    FROM prof.Profile_Owners po
                    LEFT JOIN prof.Profile_Owners parent ON parent.PrfOwn_code = po.ParentProfile_code
                    WHERE po.PrfOwn_code = @grp";
                cmd.Parameters.Add(Param("@grp", groupOwnerCode));
                using var rdr = await cmd.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    int parentCode = rdr.GetInt32(1);
                    if (parentCode > 0 && parentCode != groupOwnerCode)
                    {
                        effectiveGroupCode = rdr.GetInt32(2) > 0 ? rdr.GetInt32(2) : parentCode;
                        groupOwnerName = rdr.IsDBNull(3) || string.IsNullOrWhiteSpace(rdr.GetString(3)) 
                            ? (rdr.IsDBNull(0) ? "" : rdr.GetString(0).Trim()) 
                            : rdr.GetString(3).Trim();
                    }
                    else
                    {
                        effectiveGroupCode = groupOwnerCode;
                        groupOwnerName = rdr.IsDBNull(0) ? "" : rdr.GetString(0).Trim();
                    }
                }
            }
        }

        // 1b. Check if rows exist in dbo.Profile_invoicing for effectiveGroupCode + month.
        // If not, auto-generate them seamlessly from company invoicing and marketing sources.
        // Auto-generation is only performed for active/unprocessed view, NOT for processedOnly.
        // IMPORTANT: use the same OR filter as the data query (prfgrp_own_code OR prfown_code)
        // to avoid false-zero when rows exist via prfown_code but prfgrp_own_code is NULL.
        if (!processedOnly)
        {
            int existingCount = 0;
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT COUNT(*)
                    FROM dbo.Profile_invoicing
                    WHERE (prfgrp_own_code = @grp OR prfown_code = @grp)
                      AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
                cmd.Parameters.Add(Param("@grp", effectiveGroupCode));
                cmd.Parameters.Add(Param("@m", cleanMonth));
                existingCount = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
            }

            if (existingCount == 0)
            {
                try
                {
                    var saveReq = new ProfileInvoiceSaveRequest
                    {
                        GroupOwnerCode = effectiveGroupCode,
                        MonthYear      = cleanMonth,
                        InsertedBy     = "System"
                    };
                    await SaveAsync(saveReq, ct);
                }
                catch (Exception ex)
                {
                    // Non-fatal if calculation yielded no rows to save
                    System.Diagnostics.Debug.WriteLine($"Auto-generate profile invoices warning: {ex.Message}");
                }
            }
        }

        // 2. Fetch saved rows from dbo.Profile_invoicing
        // Sorted: prfown_code A, project_code A, interview_code A, charg_type_code A
        var savedRows = new List<(long Code, int? PrfownCode, int? ProjectCode, int? InterviewCode, int? ChargTypeCode, decimal? ChargedAmtUsd, decimal? TotalUsdCost, string? ResourceType, int InvoiceTo, bool IsIncluded, bool IsExecutive, decimal? ChargedAmtPkr, decimal? ExchangeRate, decimal? ShareAmount, bool ToBeDiscussed, bool IsProcessed)>();
        using (var cmd = conn.CreateCommand())
        {
            string ownerFilter;
            if (processedOnly)
            {
                // Group owner sees all rows for the group, or their own rows
                ownerFilter = "(pi.prfgrp_own_code = @grp OR pi.prfown_code = @grp)";
            }
            else
            {
                ownerFilter = "(pi.prfgrp_own_code = @grp OR pi.prfown_code = @grp)";
            }
            string processedFilter = processedOnly ? "AND pi.is_processed = 1" : "";
            string discussedFilter = excludeToBeDiscussed ? "AND (pi.to_be_discussed = 0 OR pi.to_be_discussed IS NULL)" : "";

            cmd.CommandText = $@"
                SELECT pi.cmp_prof_invoice_code, pi.prfown_code, pi.project_code, pi.interview_code, pi.charg_type_code,
                       pi.charged_amt_usd, pi.total_usd_cost, pi.resource_type, pi.invoice_to,
                       ISNULL(pi.is_included, 1) AS is_included,
                       CASE WHEN ISNULL(p.profile_type,'')='E' OR ISNULL(po.Profile_type,'')='E' THEN 1 ELSE 0 END AS is_executive,
                       pi.charged_amt_pkr, pi.exchange_rate, pi.share_amount,
                       ISNULL(pi.to_be_discussed, 0) AS to_be_discussed,
                       ISNULL(pi.is_processed, 0) AS is_processed
                FROM dbo.Profile_invoicing pi
                LEFT JOIN mkt.Projects p ON p.project_code = pi.project_code
                LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfown_code
                WHERE {ownerFilter} 
                  AND REPLACE(RTRIM(pi.invoice_month), '-', '') = @m
                  {processedFilter}
                  {discussedFilter}
                ORDER BY COALESCE(pi.prfown_code, 0) ASC,
                         COALESCE(pi.project_code, 0) ASC,
                         COALESCE(pi.interview_code, 0) ASC,
                         COALESCE(pi.charg_type_code, 0) ASC,
                         pi.cmp_prof_invoice_code ASC";
            cmd.Parameters.Add(Param("@grp", effectiveGroupCode));
            cmd.Parameters.Add(Param("@m", cleanMonth));

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                savedRows.Add((
                    Convert.ToInt64(reader.GetValue(0)),
                    reader.IsDBNull(1) ? null : reader.GetInt32(1),
                    reader.IsDBNull(2) ? null : reader.GetInt32(2),
                    reader.IsDBNull(3) ? null : reader.GetInt32(3),
                    reader.IsDBNull(4) ? null : reader.GetInt32(4),
                    reader.IsDBNull(5) ? null : reader.GetDecimal(5),
                    reader.IsDBNull(6) ? null : Convert.ToDecimal(reader.GetValue(6)),
                    reader.IsDBNull(7) ? null : reader.GetString(7).Trim(),
                    reader.IsDBNull(8) ? 1 : reader.GetInt32(8),
                    Convert.ToBoolean(reader.GetValue(9)),
                    Convert.ToInt32(reader.GetValue(10)) == 1,
                    reader.IsDBNull(11) ? null : reader.GetDecimal(11),
                    reader.IsDBNull(12) ? null : reader.GetDecimal(12),
                    reader.IsDBNull(13) ? null : reader.GetDecimal(13),
                    Convert.ToBoolean(reader.GetValue(14)),
                    Convert.ToBoolean(reader.GetValue(15))
                ));
            }
        }

        // Lookups for Profile Owners
        var ownerCodes = savedRows.Where(r => r.PrfownCode.HasValue && r.PrfownCode.Value > 0).Select(r => r.PrfownCode!.Value).Distinct().ToList();
        var profileNames = new Dictionary<int, string>();
        if (ownerCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT PrfOwn_code, profile_name FROM prof.Profile_Owners WHERE PrfOwn_code IN ({string.Join(",", ownerCodes)})";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                profileNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
            }
        }

        // Lookups for Projects
        var projectCodes = savedRows.Where(r => r.ProjectCode.HasValue && r.ProjectCode.Value > 0).Select(r => r.ProjectCode!.Value).Distinct().ToList();
        var projects = new Dictionary<int, (string Name, string JobType, decimal Rate, string ProfileType, int StackCode, DateTime? OpenDate, DateTime? CloseDate, string SalaryRate, int BranchCode)>();
        if (projectCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT project_code, Proj_name, job_type, proj_rate, profile_type, stack_cde,
                       proj_opening_dte, proj_close_dte, salary_rate, branch_code
                FROM mkt.Projects
                WHERE project_code IN ({string.Join(",", projectCodes)})";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int pCode = reader.GetInt32(0);
                string pName = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
                string jobType = reader.IsDBNull(2) ? "" : reader.GetString(2).Trim();
                decimal rate = reader.IsDBNull(3) ? 0 : reader.GetDecimal(3);
                string pType = reader.IsDBNull(4) ? "" : reader.GetString(4).Trim();
                int sCode = reader.IsDBNull(5) ? 0 : reader.GetInt32(5);
                DateTime? oDate = reader.IsDBNull(6) ? null : reader.GetDateTime(6);
                DateTime? cDate = reader.IsDBNull(7) ? null : reader.GetDateTime(7);
                string sRate = reader.IsDBNull(8) ? "" : reader.GetString(8).Trim();
                int bCode = reader.IsDBNull(9) ? 0 : reader.GetInt32(9);
                projects[pCode] = (pName, jobType, rate, pType, sCode, oDate, cDate, sRate, bCode);
            }
        }

        // Lookups for Stacks
        var stackCodes = projects.Values.Select(p => p.StackCode).Where(s => s > 0).Distinct().ToList();
        var stackNames = new Dictionary<int, string>();
        if (stackCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT stack_code, stack_name FROM setups.Stacks WHERE stack_code IN ({string.Join(",", stackCodes)})";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                stackNames[reader.GetInt32(0)] = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
            }
        }

        // Lookups for Company Branches (ForeignBranchCode = 5)
        string foreignBranchName = "Foreign Branch";
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT branch_name FROM dbo.Company_branches WHERE branch_code = 5";
            var obj = await cmd.ExecuteScalarAsync(ct);
            if (obj != null && obj != DBNull.Value)
            {
                foreignBranchName = obj.ToString()?.Trim() ?? "Foreign Branch";
            }
        }

        // Lookups for Chargibility (resource_nature)
        var chargTypeCodes = savedRows.Where(r => r.ChargTypeCode.HasValue && r.ChargTypeCode.Value > 0).Select(r => r.ChargTypeCode!.Value).Distinct().ToList();
        var chargibilityNames = new Dictionary<int, string>();
        if (chargTypeCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT charg_type_code, resource_nature FROM setups.Chargibility WHERE charg_type_code IN ({string.Join(",", chargTypeCodes)})";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int cCode = reader.GetInt32(0);
                string nature = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
                if (!chargibilityNames.ContainsKey(cCode))
                {
                    chargibilityNames[cCode] = nature;
                }
            }
        }

        // Lookups for Days from mkt.project_invoicing (JH first, then SL fallback)
        var projectDays = new Dictionary<int, List<(string ResType, int ProDays, int MonthDays)>>();
        if (projectCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT project_code, resource_type, pro_rate_days, month_days
                FROM mkt.project_invoicing
                WHERE project_code IN ({string.Join(",", projectCodes)})
                  AND REPLACE(RTRIM(month_year), '-', '') = @m
                  AND resource_type IN ('JH', 'SL')";
            cmd.Parameters.Add(Param("@m", cleanMonth));

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int pCode = reader.GetInt32(0);
                string rType = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim().ToUpperInvariant();
                int pDays = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
                int mDays = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
                if (!projectDays.TryGetValue(pCode, out var dList))
                {
                    dList = new List<(string ResType, int ProDays, int MonthDays)>();
                    projectDays[pCode] = dList;
                }
                dList.Add((rType, pDays, mDays));
            }
        }

        // Lookups for Interviews
        var interviewCodes = savedRows
            .Where(r => (!r.ProjectCode.HasValue || r.ProjectCode.Value == 0) && r.InterviewCode.HasValue && r.InterviewCode.Value > 0)
            .Select(r => r.InterviewCode!.Value)
            .Distinct()
            .ToList();
        var interviewInfo = new Dictionary<int, (string ProjName, string DateFormatted)>();
        if (interviewCodes.Count > 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT im.interview_code, im.company_name, e.Full_name, id.entity_code, id.intv_datetime
                FROM mkt.interview_master im
                LEFT JOIN mkt.interview_detail id ON id.interview_code = im.interview_code
                LEFT JOIN hrms.entity e ON e.entity_code = id.entity_code
                WHERE im.interview_code IN ({string.Join(",", interviewCodes)})";
            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                int iCode = reader.GetInt32(0);
                string comp = reader.IsDBNull(1) ? "" : reader.GetString(1).Trim();
                string dev = "";
                if (!reader.IsDBNull(2) && !string.IsNullOrWhiteSpace(reader.GetString(2)))
                {
                    dev = reader.GetString(2).Trim();
                }
                else if (!reader.IsDBNull(3))
                {
                    dev = reader.GetValue(3).ToString()?.Trim() ?? "";
                }
                string pName = (!string.IsNullOrEmpty(comp) || !string.IsNullOrEmpty(dev))
                    ? $"{comp}-{dev}"
                    : $"Interview-{iCode}";
                string dt = reader.IsDBNull(4)
                    ? ""
                    : reader.GetDateTime(4).ToString("dd-MMM-yy", System.Globalization.CultureInfo.InvariantCulture).ToUpperInvariant();
                interviewInfo[iCode] = (pName, dt);
            }
        }

        // Build result
        var result = new ProfileInvoiceExcelViewResult
        {
            GroupOwnerCode = effectiveGroupCode,
            GroupOwnerName = groupOwnerName,
            MonthYear = cleanMonth,
            IsFinalized = await IsMonthFinalizedAsync(cleanMonth, ct),
            TotalSavedRows = savedRows.Count
        };

        // 1. Group saved rows into Project Blocks
        // A project block contains all charge rows for a (PrfownCode, ProjectCode) pair (or (PrfownCode, InterviewCode) for standalone rows).
        var blocks = new List<(
            int CurOwn,
            int CurProj,
            int CurInt,
            string StackName,
            string ProjName,
            string ProfileOwner,
            string StartEndDate,
            List<(long Code, int? PrfownCode, int? ProjectCode, int? InterviewCode, int? ChargTypeCode, decimal? ChargedAmtUsd, decimal? TotalUsdCost, string? ResourceType, int InvoiceTo, bool IsIncluded, bool IsExecutive, decimal? ChargedAmtPkr, decimal? ExchangeRate, decimal? ShareAmount, bool ToBeDiscussed, bool IsProcessed)> Rows
        )>();

        int curIdx = 0;
        int totalSavedCount = savedRows.Count;
        while (curIdx < totalSavedCount)
        {
            var curRow = savedRows[curIdx];
            int curOwn = curRow.PrfownCode ?? 0;
            int curProj = curRow.ProjectCode ?? 0;
            int curInt = curRow.InterviewCode ?? 0;

            var blockRows = new List<(long Code, int? PrfownCode, int? ProjectCode, int? InterviewCode, int? ChargTypeCode, decimal? ChargedAmtUsd, decimal? TotalUsdCost, string? ResourceType, int InvoiceTo, bool IsIncluded, bool IsExecutive, decimal? ChargedAmtPkr, decimal? ExchangeRate, decimal? ShareAmount, bool ToBeDiscussed, bool IsProcessed)>();
            int endIdx = curIdx;
            for (int k = curIdx; k < totalSavedCount; k++)
            {
                var kRow = savedRows[k];
                int kOwn = kRow.PrfownCode ?? 0;
                int kProj = kRow.ProjectCode ?? 0;
                int kInt = kRow.InterviewCode ?? 0;

                if (kOwn != curOwn || kProj != curProj) break;
                if (curProj == 0 && kInt != curInt) break;

                blockRows.Add(kRow);
                endIdx = k;
            }

            string profileOwner = profileNames.TryGetValue(curOwn, out var poName) ? poName : "";
            string curProjName = "";
            string stackName = "";
            string startEndDt = "";

            if (curProj > 0 && projects.TryGetValue(curProj, out var pInfo))
            {
                curProjName = pInfo.Name ?? "";
                if (pInfo.StackCode > 0 && stackNames.TryGetValue(pInfo.StackCode, out var sName) && !string.IsNullOrWhiteSpace(sName))
                {
                    stackName = sName.Trim();
                }
            }
            else if (curProj == 0 && curInt > 0)
            {
                if (interviewInfo.TryGetValue(curInt, out var iInfo))
                {
                    curProjName = iInfo.ProjName;
                    startEndDt = iInfo.DateFormatted;
                }
                else
                {
                    curProjName = $"Interview-{curInt}";
                }
            }

            blocks.Add((curOwn, curProj, curInt, stackName, curProjName, profileOwner, startEndDt, blockRows));
            curIdx = endIdx + 1;
        }

        // 2. Order blocks:
        // owner (prfown_code) -> us owner ke projects (project_code asc) -> phir us owner ki interviews (interview_code asc) -> other expenses -> agla owner.
        // Stack heading rows / grouping removed.
        var orderedBlocks = blocks
            .OrderBy(b => b.CurOwn)
            .ThenBy(b => b.CurProj > 0 ? 0 : (b.CurInt > 0 ? 1 : 2))
            .ThenBy(b => b.CurProj)
            .ThenBy(b => b.CurInt)
            .ToList();

        decimal sumCost = 0;
        decimal sumActual = 0;
        decimal sumOther = 0;
        decimal sumAgreed = 0;
        int projectBlockCount = 0;
        int prevSingleOwn = -1;

        for (int bIdx = 0; bIdx < orderedBlocks.Count; bIdx++)
        {
            var block = orderedBlocks[bIdx];
            int curOwn = block.CurOwn;
            int curProj = block.CurProj;
            int curInt = block.CurInt;

            // Rizviz Share: project_code > 0 par JH rows ka sum(share_amount) (JH na ho to SL)
            decimal projShare = 0;
            if (curProj > 0)
            {
                var jhRows = block.Rows.Where(r => string.Equals(r.ResourceType, "JH", StringComparison.OrdinalIgnoreCase)).ToList();
                var targetShareRows = jhRows.Count > 0
                    ? jhRows
                    : block.Rows.Where(r => string.Equals(r.ResourceType, "SL", StringComparison.OrdinalIgnoreCase)).ToList();
                projShare = Math.Round(targetShareRows.Sum(r => r.ShareAmount ?? 0m), 0, MidpointRounding.AwayFromZero);
            }

            // Project total = sum(Round(total_usd_cost, 0)) + projShare
            // KAAM 1 Rule 4: Total Cost / Total USD sum par IsIncluded ka asar NA ho
            decimal projTotal = 0;
            foreach (var kRow in block.Rows)
            {
                decimal kFinal = Math.Round(kRow.TotalUsdCost ?? 0m, 0, MidpointRounding.AwayFromZero);
                projTotal += kFinal;
            }

            if (curProj > 0)
            {
                // Share project ke Total Cost mein jaye
                projTotal += projShare;
                sumCost += projTotal;
                projectBlockCount++;
            }

            string profileOwner = block.ProfileOwner;
            string ownerDisp = profileOwner;
            if (curProj == 0 && prevSingleOwn == curOwn)
            {
                ownerDisp = "";
            }

            string curProjName = block.ProjName;
            string curJobType = "";
            decimal curProjRate = 0;
            string curProfileType = "";
            int curStackCode = 0;
            DateTime? curOpenDate = null;
            DateTime? curCloseDate = null;
            string curSalaryRate = "";
            int curBranchCode = 0;

            if (curProj > 0 && projects.TryGetValue(curProj, out var pInfo))
            {
                curProjName = pInfo.Name;
                curJobType = pInfo.JobType;
                curProjRate = Math.Round(pInfo.Rate, 0, MidpointRounding.AwayFromZero);
                curProfileType = pInfo.ProfileType;
                curStackCode = pInfo.StackCode;
                curOpenDate = pInfo.OpenDate;
                curCloseDate = pInfo.CloseDate;
                curSalaryRate = pInfo.SalaryRate;
                curBranchCode = pInfo.BranchCode;
            }

            // Project Status
            string projStatus = "";
            if (curProj > 0)
            {
                if (!curOpenDate.HasValue && !curCloseDate.HasValue)
                    projStatus = "Tentative";
                else if (!curCloseDate.HasValue)
                    projStatus = "In-Progress";
                else
                    projStatus = "Closed";
            }

            // Salary Rate
            string salaryRateFormatted = "";
            if (curProj > 0 && !string.IsNullOrWhiteSpace(curSalaryRate))
            {
                string trimmed = curSalaryRate.Trim();
                if (decimal.TryParse(trimmed, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var salDec))
                {
                    salaryRateFormatted = Math.Round(salDec, 0, MidpointRounding.AwayFromZero).ToString("0");
                }
                else
                {
                    salaryRateFormatted = trimmed;
                }
            }

            // Dates
            string startEndDate = block.StartEndDate;
            if (curProj > 0)
            {
                if (curOpenDate.HasValue && curCloseDate.HasValue)
                    startEndDate = $"{curOpenDate.Value:dd-MMM-yy} / {curCloseDate.Value:dd-MMM-yy}";
                else if (curOpenDate.HasValue)
                    startEndDate = $"{curOpenDate.Value:dd-MMM-yy}";
                else if (curCloseDate.HasValue)
                    startEndDate = $" / {curCloseDate.Value:dd-MMM-yy}";
            }

            // Profile Nature
            string profileNature = (curProj > 0 && string.Equals(curProfileType?.Trim(), "E", StringComparison.OrdinalIgnoreCase))
                ? "Executive"
                : "";

            // Handled From
            string handledFrom = (curProj > 0 && curBranchCode == ForeignBranchCode)
                ? foreignBranchName
                : "";

            bool projHasIncluded = block.Rows.Any(r => r.IsIncluded);
            bool projHeaderIncluded = true;

            // Days calculation & Actual Charges
            string hoursDays = "";
            int? pDays = null;
            int? mDays = null;
            decimal? actualCharges = null;
            if (curProj > 0 && projectDays.TryGetValue(curProj, out var allDaysList))
            {
                var jhRows = allDaysList.Where(d => d.ResType == "JH").ToList();
                var targetDays = jhRows.Count > 0 ? jhRows : allDaysList.Where(d => d.ResType == "SL").ToList();

                int proDays = targetDays.Sum(d => d.ProDays);
                int monthDays = targetDays.Count > 0 ? targetDays.Max(d => d.MonthDays) : 0;

                if (targetDays.Count > 0 && monthDays > 0)
                {
                    hoursDays = $"{proDays}/{monthDays}";
                    pDays = proDays;
                    mDays = monthDays;
                    if (curProjRate > 0)
                    {
                        decimal act = Math.Round(curProjRate / (decimal)monthDays * (decimal)proDays, 0, MidpointRounding.AwayFromZero);
                        actualCharges = act;
                        sumActual += act;
                    }
                }
            }

            // If curProj > 0, output Project Header Row
            if (curProj > 0)
            {
                // KAAM 1 Rule 4: Total Agreed (H) par IsIncluded ka koi asar NA ho
                if (curProjRate > 0)
                {
                    sumAgreed += curProjRate;
                }

                result.Rows.Add(new ProfileInvoiceExcelViewRowDto
                {
                    RowType = "ProjectHeader",
                    IsIncluded = projHeaderIncluded,
                    IsExecutive = string.Equals(curProfileType?.Trim(), "E", StringComparison.OrdinalIgnoreCase),
                    ProfileOwner = ownerDisp,
                    ProjectCode = curProj,
                    ProjectName = curProjName,
                    TotalCost = projTotal,
                    AgreedRate = curProjRate,
                    HoursDays = hoursDays,
                    ProDays = pDays,
                    MonthDays = mDays,
                    ActualCharges = actualCharges,
                    SalaryRate = salaryRateFormatted,
                    StartEndDate = startEndDate,
                    ProjStatus = projStatus,
                    Stack = block.StackName,
                    BranchCode = curBranchCode,
                    IsForeign = (curBranchCode == ForeignBranchCode),
                    JobType = curJobType,
                    ProfileNature = profileNature,
                    HandledFrom = handledFrom,
                    ToBeDiscussed = block.Rows.Any(r => r.ToBeDiscussed),
                    IsToBeDiscussed = block.Rows.Any(r => r.ToBeDiscussed),
                    IsProcessed = block.Rows.All(r => r.IsProcessed),
                    ChildInvoiceCodes = block.Rows.Select(r => r.Code).ToList()
                });
            }

            // Find index of the last JH row (or last SL row) for inserting Rizviz Share detail row
            int lastShareTargetIdx = -1;
            if (curProj > 0 && projShare > 0)
            {
                for (int i = block.Rows.Count - 1; i >= 0; i--)
                {
                    if (string.Equals(block.Rows[i].ResourceType, "JH", StringComparison.OrdinalIgnoreCase))
                    {
                        lastShareTargetIdx = i;
                        break;
                    }
                }
                if (lastShareTargetIdx == -1)
                {
                    for (int i = block.Rows.Count - 1; i >= 0; i--)
                    {
                        if (string.Equals(block.Rows[i].ResourceType, "SL", StringComparison.OrdinalIgnoreCase))
                        {
                            lastShareTargetIdx = i;
                            break;
                        }
                    }
                }
            }

            // Detail rows loop
            for (int rIdx = 0; rIdx < block.Rows.Count; rIdx++)
            {
                var dRow = block.Rows[rIdx];
                // Final USD = Round(total_usd_cost, 0), charged_amt_usd nahi. Other Charge bhi isi se.
                decimal finalUsd = Math.Round(dRow.TotalUsdCost ?? 0m, 0, MidpointRounding.AwayFromZero);

                string resType = dRow.ResourceType?.Trim().ToUpperInvariant() ?? "";
                string serviceHead = "";
                bool isOther = true;

                switch (resType)
                {
                    case "JH":
                        serviceHead = "Job Holder";
                        isOther = false;
                        break;
                    case "SP":
                        serviceHead = "Support Provider";
                        isOther = false;
                        break;
                    case "SL":
                        serviceHead = "Special";
                        isOther = true;
                        break;
                    case "DR":
                        serviceHead = "Second Resource";
                        isOther = false;
                        break;
                    case "BB":
                        serviceHead = "BD-Commission";
                        isOther = true;
                        break;
                    case "BE":
                        serviceHead = "BD Recurr. Comm. - EXE";
                        isOther = true;
                        break;
                    case "BR":
                        serviceHead = "BD Recurr. Comm. - REG";
                        isOther = true;
                        break;
                    case "I1":
                        serviceHead = "Interview Commission - 1st";
                        isOther = true;
                        break;
                    case "J1":
                        serviceHead = "Interview Commission - 2nd";
                        isOther = true;
                        break;
                    case "X1":
                        serviceHead = "DEV Recurr. Comm.";
                        isOther = true;
                        break;
                    case "TZ":
                        serviceHead = "TimeZone Allowance";
                        isOther = true;
                        break;
                    case "BO":
                        serviceHead = "Bonus";
                        isOther = true;
                        break;
                    case "TL":
                        serviceHead = "TL-Allounce";
                        isOther = true;
                        break;
                    case "BS":
                        serviceHead = "DEV/Marketing";
                        isOther = true;
                        break;
                    case "IT":
                        serviceHead = "Interview";
                        isOther = true;
                        break;
                    case "OE":
                        serviceHead = "";
                        isOther = true;
                        break;
                    default:
                        serviceHead = "";
                        break;
                }

                if (string.IsNullOrEmpty(serviceHead))
                {
                    isOther = true;
                    if (dRow.ChargTypeCode.HasValue && chargibilityNames.TryGetValue(dRow.ChargTypeCode.Value, out var cName))
                    {
                        serviceHead = cName;
                    }
                }

                // PB rule: Company projects (profile_type = 'C') exclude Other Charge.
                // Executive projects (profile_type = 'E') DO have Other charges included (Bonus, BD Recurr, DEV Recurr, etc.)
                if (curProj > 0 && string.Equals(curProfileType?.Trim(), "C", StringComparison.OrdinalIgnoreCase))
                {
                    isOther = false;
                }

                if (isOther && dRow.IsIncluded)
                {
                    sumOther += finalUsd;
                }

                if (curProj > 0)
                {
                    result.Rows.Add(new ProfileInvoiceExcelViewRowDto
                    {
                        RowType = "Detail",
                        CmpProfInvoiceCode = dRow.Code,
                        IsIncluded = dRow.IsIncluded,
                        IsExecutive = dRow.IsExecutive,
                        BranchCode = curBranchCode,
                        IsForeign = (curBranchCode == ForeignBranchCode),
                        ServiceHead = serviceHead,
                        FinalUsd = finalUsd,
                        ChargedAmtUsd = dRow.ChargedAmtUsd ?? (dRow.TotalUsdCost + (dRow.ShareAmount ?? 0m)),
                        OtherCharge = isOther ? finalUsd : null,
                        ChargedAmtPkr = isOther ? dRow.ChargedAmtPkr : null,
                        ExchangeRate = isOther ? dRow.ExchangeRate : null,
                        ShareAmount = isOther ? dRow.ShareAmount : null,
                        ToBeDiscussed = dRow.ToBeDiscussed,
                        IsToBeDiscussed = dRow.ToBeDiscussed,
                        IsProcessed = dRow.IsProcessed,
                        ChildInvoiceCodes = new List<long> { dRow.Code }
                    });

                    // Ek alag "Rizviz Share" detail row aakhri JH (ya SL) row ke baad, sirf share>0.
                    // Share project ke Total Cost mein jaye, Total Invoice (Actual+Other) mein nahi.
                    if (projShare > 0 && rIdx == lastShareTargetIdx)
                    {
                        result.Rows.Add(new ProfileInvoiceExcelViewRowDto
                        {
                            RowType = "Detail",
                            CmpProfInvoiceCode = null,
                            IsIncluded = projHasIncluded,
                            IsExecutive = string.Equals(curProfileType?.Trim(), "E", StringComparison.OrdinalIgnoreCase),
                            BranchCode = curBranchCode,
                            IsForeign = (curBranchCode == ForeignBranchCode),
                            ServiceHead = "Rizviz Share",
                            FinalUsd = projShare,
                            OtherCharge = null, // Share Total Invoice mein nahi jaye
                            ChargedAmtPkr = null,
                            ExchangeRate = null,
                            ShareAmount = null
                        });
                    }
                }
                else
                {
                    // Standalone row (curProj == 0)
                    // KAAM 1 Rule 4: Total Cost / Total USD par IsIncluded ka koi asar NA ho
                    sumCost += finalUsd;
                    result.Rows.Add(new ProfileInvoiceExcelViewRowDto
                    {
                        RowType = "Standalone",
                        CmpProfInvoiceCode = dRow.Code,
                        IsIncluded = dRow.IsIncluded,
                        IsExecutive = dRow.IsExecutive,
                        BranchCode = curBranchCode,
                        IsForeign = (curBranchCode == ForeignBranchCode),
                        ProfileOwner = ownerDisp,
                        ProjectName = curProjName,
                        ServiceHead = serviceHead,
                        FinalUsd = finalUsd,
                        ChargedAmtUsd = dRow.ChargedAmtUsd ?? (dRow.TotalUsdCost + (dRow.ShareAmount ?? 0m)),
                        TotalCost = finalUsd,
                        OtherCharge = isOther ? finalUsd : null,
                        ChargedAmtPkr = isOther ? dRow.ChargedAmtPkr : null,
                        ExchangeRate = isOther ? dRow.ExchangeRate : null,
                        ShareAmount = isOther ? dRow.ShareAmount : null,
                        StartEndDate = startEndDate,
                        ToBeDiscussed = dRow.ToBeDiscussed,
                        IsToBeDiscussed = dRow.ToBeDiscussed,
                        IsProcessed = dRow.IsProcessed,
                        ChildInvoiceCodes = new List<long> { dRow.Code }
                    });
                    ownerDisp = "";
                }
            }

            // Blank row separator:
            // Blank row after every project; for interviews/standalone, blank row only when run ends
            if (curProj > 0)
            {
                result.Rows.Add(new ProfileInvoiceExcelViewRowDto { RowType = "Blank" });
                prevSingleOwn = -1;
            }
            else
            {
                prevSingleOwn = curOwn;
                bool isLastInRun = (bIdx == orderedBlocks.Count - 1)
                    || (orderedBlocks[bIdx + 1].CurOwn != curOwn)
                    || (orderedBlocks[bIdx + 1].CurProj > 0);
                if (isLastInRun)
                {
                    result.Rows.Add(new ProfileInvoiceExcelViewRowDto { RowType = "Blank" });
                    prevSingleOwn = -1;
                }
            }
        }

        result.TotalCostSum = sumCost;
        result.ActualChargesSum = sumActual;
        result.OtherChargeSum = sumOther;
        result.TotalInvoice = sumActual + sumOther;
        result.AgreedRateSum = sumAgreed;
        result.FinalUsdSum = sumCost;
        result.TotalProjectBlocks = projectBlockCount;

        return result;
    }

    public Task<byte[]> GetExcelDownloadAsync(
        int groupOwnerCode, string monthYear, CancellationToken ct = default)
        => GetExcelDownloadAsync(groupOwnerCode, monthYear, false, false, null, ct);

    public Task<byte[]> GetExcelDownloadAsync(
        int groupOwnerCode, string monthYear, bool processedOnly, int? specificOwnerCode = null, CancellationToken ct = default)
        => GetExcelDownloadAsync(groupOwnerCode, monthYear, processedOnly, false, specificOwnerCode, ct);

    public async Task<byte[]> GetExcelDownloadAsync(
        int groupOwnerCode, string monthYear, bool processedOnly, bool excludeToBeDiscussed, int? specificOwnerCode = null, CancellationToken ct = default)
    {
        var view = await GetExcelViewAsync(groupOwnerCode, monthYear, processedOnly, specificOwnerCode, ct, excludeToBeDiscussed);

        // ── Sheet name: "Invoice SEP-26" style (insert hyphen before 2-digit year) ──
        string sheetName = "Invoice " + System.Text.RegularExpressions.Regex.Replace(
            view.MonthYear, @"^([A-Z]+)(\d{2})$", "$1-$2");

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(sheetName);

        // ── Global defaults: Arial 10, no gridlines, freeze panes ────────────────
        ws.Style.Font.FontName = "Arial";
        ws.Style.Font.FontSize = 10;
        ws.ShowGridLines = false;
        ws.SheetView.Freeze(4, 4);       // freeze panes: rows 1-4, cols A-D frozen

        const string numFmt = "#,##0.00;(#,##0.00);-";
        const string redColor  = "FF0000";
        const string navyColor = "1F3864";
        const string lightBlue = "DDEBF7";
        const string white     = "FFFFFF";

        // ── Column widths (16 columns: Stack before Project Name; Inc after Other Charge) ──
        // Col 1 (A): Profile Owner
        // Col 2 (B): Project Code
        // Col 3 (C): Stack
        // Col 4 (D): Project Name
        // Col 5 (E): Service Head
        // Col 6 (F): Agreed Rate
        // Col 7 (G): Hours/Days
        // Col 8 (H): Actual Charges
        // Col 9 (I): Other Charge
        // Col 10 (J): Include
        // Col 11 (K): Salary Rate
        // Col 12 (L): Start Date / End Date
        // Col 13 (M): Proj Status
        // Col 14 (N): Job Type
        // Col 15 (O): Profile Nature
        // Col 16 (P): Handled From
        ws.Column(1).Width  = 24; // Profile Owner
        ws.Column(2).Width  = 13; // Project Code
        ws.Column(3).Width  = 16; // Stack
        ws.Column(4).Width  = 28; // Project Name
        ws.Column(5).Width  = 20; // Service Head
        ws.Column(6).Width  = 12; // Agreed Rate
        ws.Column(7).Width  = 12; // Hours/Days
        ws.Column(8).Width  = 15; // Actual Charges
        ws.Column(9).Width  = 13; // Other Charge
        ws.Column(10).Width = 10; // Include
        ws.Column(11).Width = 12; // Salary Rate
        ws.Column(12).Width = 24; // Start Date / End Date
        ws.Column(13).Width = 13; // Proj Status
        ws.Column(14).Width = 10; // Job Type
        ws.Column(15).Width = 15; // Profile Nature
        ws.Column(16).Width = 26; // Handled From

        // ── Helper: apply base font across a cell ────────────────────────────────
        static void ApplyBase(IXLCell c, bool bold = false, string? color = null)
        {
            c.Style.Font.FontName = "Arial";
            c.Style.Font.FontSize = 10;
            c.Style.Font.Bold = bold;
            if (color != null) c.Style.Font.FontColor = XLColor.FromHtml(color);
        }

        int lastRow = Math.Max(5, 4 + view.Rows.Count);

        // ── Row 1: metadata & live formula for Total Invoice ───────────────────────
        var c1A = ws.Cell(1, 1);
        c1A.Value = $"Profile Group Owner : {view.GroupOwnerName}";
        ApplyBase(c1A, bold: true);

        var c1G = ws.Cell(1, 7);
        c1G.Value = "Total Invoice";
        ApplyBase(c1G, bold: true);

        var c1H = ws.Cell(1, 8);
        c1H.Value = "USD";
        ApplyBase(c1H, bold: true);

        var c1I = ws.Cell(1, 9);
        c1I.FormulaA1 = "ROUND(H3 + I3, 0)";
        ApplyBase(c1I, bold: true, color: redColor);
        c1I.Style.NumberFormat.Format = numFmt;

        // ── Row 2: month ────────────────────────────────────────────────────────
        var c2A = ws.Cell(2, 1);
        string monthDisplay = System.Text.RegularExpressions.Regex.Replace(
            view.MonthYear, @"^([A-Z]+)(\d{2})$", "$1-$2");
        c2A.Value = $"Month/Year : {monthDisplay}";
        ApplyBase(c2A, bold: true);

        // ── Row 3: totals with live SUMIF formulas filtering only Include=1 (Col J) rows ───
        var c3G = ws.Cell(3, 7);
        c3G.Value = "Sum";
        ApplyBase(c3G, bold: true);

        var c3H = ws.Cell(3, 8);
        c3H.FormulaA1 = $"SUM(H5:H{lastRow})";
        ApplyBase(c3H, bold: true, color: redColor);
        c3H.Style.NumberFormat.Format = numFmt;

        var c3I = ws.Cell(3, 9);
        c3I.FormulaA1 = $"SUMIF(J5:J{lastRow}, 1, I5:I{lastRow})";
        ApplyBase(c3I, bold: true, color: redColor);
        c3I.Style.NumberFormat.Format = numFmt;

        // ── Row 4: column header row (16 columns, navy fill, white bold, centered) ───
        string[] headers = {
            "Profile Owner", "Project Code", "Stack", "Project Name", "Service Head",
            "Agreed Rate", "Hours/Days", "Actual Charges", "Other Charge", "Include",
            "Salary Rate", "Start Date / End Date", "Proj. Status",
            "Job Type", "Profile Nature", "Handled From"
        };
        for (int col = 1; col <= headers.Length; col++)
        {
            var ch = ws.Cell(4, col);
            ch.Value = headers[col - 1];
            ch.Style.Font.FontName  = "Arial";
            ch.Style.Font.FontSize  = 10;
            ch.Style.Font.Bold      = true;
            ch.Style.Font.FontColor = XLColor.FromHtml(white);
            ch.Style.Fill.BackgroundColor = XLColor.FromHtml(navyColor);
            ch.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ch.Style.Alignment.Vertical   = XLAlignmentVerticalValues.Center;
        }

        // Helper to apply row-level formulas for Other Charge (PKR to USD) in Col 9 (I)
        void ApplyOtherChargeFormula(int rowNum, ProfileInvoiceExcelViewRowDto rowDto)
        {
            bool hasPkrAndRate = rowDto.ChargedAmtPkr.HasValue && rowDto.ChargedAmtPkr.Value != 0 && rowDto.ExchangeRate.HasValue && rowDto.ExchangeRate.Value > 0;

            if (hasPkrAndRate)
            {
                string pkr = rowDto.ChargedAmtPkr!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
                string rate = rowDto.ExchangeRate!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
                ws.Cell(rowNum, 9).FormulaA1 = $"ROUND({pkr} / {rate}, 0)";
                ws.Cell(rowNum, 9).Style.Font.FontColor = XLColor.FromHtml(redColor);
                ws.Cell(rowNum, 9).Style.NumberFormat.Format = numFmt;
            }
            else if (rowDto.OtherCharge.HasValue)
            {
                ws.Cell(rowNum, 9).SetValue(rowDto.OtherCharge.Value);
                ws.Cell(rowNum, 9).Style.Font.FontColor = XLColor.FromHtml(redColor);
                ws.Cell(rowNum, 9).Style.NumberFormat.Format = numFmt;
            }
        }

        // ── Data rows ────────────────────────────────────────────────────────────
        int currentRow = 5;
        foreach (var r in view.Rows)
        {
            if (r.RowType == "Blank")
            {
                currentRow++;
                continue;
            }

            bool isHeader = r.RowType == "ProjectHeader";

            // Set Include flag in Column 10 (J)
            ws.Cell(currentRow, 10).SetValue(r.IsIncluded == false ? 0 : 1);
            ws.Cell(currentRow, 10).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Cell(currentRow, 10).Style.NumberFormat.Format = "0";

            if (isHeader)
            {
                if (!string.IsNullOrEmpty(r.ProfileOwner)) ws.Cell(currentRow, 1).SetValue(r.ProfileOwner);
                if (r.ProjectCode.HasValue && r.ProjectCode.Value > 0)
                {
                    ws.Cell(currentRow, 2).SetValue(r.ProjectCode.Value);
                    ws.Cell(currentRow, 2).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                }
                if (!string.IsNullOrEmpty(r.Stack))
                {
                    ws.Cell(currentRow, 3).SetValue(r.Stack);
                    ws.Cell(currentRow, 3).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                }
                if (!string.IsNullOrEmpty(r.ProjectName))   ws.Cell(currentRow, 4).SetValue(r.ProjectName);
                if (r.AgreedRate.HasValue)
                {
                    ws.Cell(currentRow, 6).SetValue(r.AgreedRate.Value);
                    ws.Cell(currentRow, 6).Style.NumberFormat.Format = numFmt;
                }
                if (!string.IsNullOrEmpty(r.HoursDays))
                {
                    ws.Cell(currentRow, 7).SetValue(r.HoursDays);
                    ws.Cell(currentRow, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                }

                // Live formula for Actual Charges (Col H / Col 8, referring to Col F Agreed Rate)
                if (r.ActualCharges.HasValue && r.MonthDays.HasValue && r.MonthDays.Value > 0 && r.ProDays.HasValue)
                {
                    ws.Cell(currentRow, 8).FormulaA1 = $"IF({r.MonthDays.Value}>0, ROUND(F{currentRow} / {r.MonthDays.Value} * {r.ProDays.Value}, 0), ROUND(F{currentRow}, 0))";
                    ws.Cell(currentRow, 8).Style.Font.FontColor = XLColor.FromHtml(redColor);
                    ws.Cell(currentRow, 8).Style.NumberFormat.Format = numFmt;
                }
                else if (r.ActualCharges.HasValue)
                {
                    ws.Cell(currentRow, 8).FormulaA1 = $"ROUND(F{currentRow}, 0)";
                    ws.Cell(currentRow, 8).Style.Font.FontColor = XLColor.FromHtml(redColor);
                    ws.Cell(currentRow, 8).Style.NumberFormat.Format = numFmt;
                }

                if (!string.IsNullOrEmpty(r.SalaryRate))
                {
                    ws.Cell(currentRow, 11).SetValue(r.SalaryRate);
                    ws.Cell(currentRow, 11).Style.NumberFormat.Format = numFmt;
                }
                if (!string.IsNullOrEmpty(r.StartEndDate))
                {
                    ws.Cell(currentRow, 12).SetValue(r.StartEndDate);
                    ws.Cell(currentRow, 12).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                }
                if (!string.IsNullOrEmpty(r.ProjStatus))  ws.Cell(currentRow, 13).SetValue(r.ProjStatus);
                if (!string.IsNullOrEmpty(r.JobType))     ws.Cell(currentRow, 14).SetValue(r.JobType);
                if (!string.IsNullOrEmpty(r.ProfileNature)) ws.Cell(currentRow, 15).SetValue(r.ProfileNature);
                if (!string.IsNullOrEmpty(r.HandledFrom)) ws.Cell(currentRow, 16).SetValue(r.HandledFrom);
            }
            else if (r.RowType == "Detail")
            {
                if (!string.IsNullOrEmpty(r.ServiceHead)) ws.Cell(currentRow, 5).SetValue(r.ServiceHead);
                ApplyOtherChargeFormula(currentRow, r);
            }
            else if (r.RowType == "Standalone")
            {
                if (!string.IsNullOrEmpty(r.ProfileOwner)) ws.Cell(currentRow, 1).SetValue(r.ProfileOwner);
                if (!string.IsNullOrEmpty(r.Stack)) ws.Cell(currentRow, 3).SetValue(r.Stack);
                if (!string.IsNullOrEmpty(r.ProjectName))   ws.Cell(currentRow, 4).SetValue(r.ProjectName);
                if (!string.IsNullOrEmpty(r.ServiceHead)) ws.Cell(currentRow, 5).SetValue(r.ServiceHead);
                ApplyOtherChargeFormula(currentRow, r);
                if (!string.IsNullOrEmpty(r.StartEndDate))
                {
                    ws.Cell(currentRow, 12).SetValue(r.StartEndDate);
                    ws.Cell(currentRow, 12).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                }
            }

            // ── Per-row styling (16 columns) ─────────────────────────────────────
            var rowRange = ws.Range(currentRow, 1, currentRow, 16);

            foreach (var cell in rowRange.Cells())
            {
                cell.Style.Font.FontName = "Arial";
                cell.Style.Font.FontSize = 10;
                cell.Style.Font.Bold     = isHeader;
            }

            if (r.IsToBeDiscussed || r.ToBeDiscussed)
            {
                // Light red fill for To Be Discussed rows (Priority: red > blue Foreign)
                rowRange.Style.Fill.BackgroundColor = XLColor.FromHtml("FEE2E2");
            }
            else if (r.IsForeign)
            {
                // Prominent blue fill for Foreign cases (Branch 5)
                rowRange.Style.Fill.BackgroundColor = XLColor.FromHtml("9BC2E6");
            }
            else if (isHeader)
            {
                rowRange.Style.Fill.BackgroundColor = XLColor.FromHtml(lightBlue);
            }

            currentRow++;
        }

        // Recalculate all formulas so workbook opens with pre-cached evaluated values matching backend
        wb.RecalculateAllFormulas();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public async Task<List<ProfileInvoiceProcessedRowDto>> GetProcessedInvoicesAsync(string month, int? groupOwnerCode = null, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var list = new List<ProfileInvoiceProcessedRowDto>();

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        using var cmd = conn.CreateCommand();
        string sql = @"
            SELECT 
                pi.cmp_prof_invoice_code,
                pi.prfown_code,
                ISNULL(po.profile_name, 'Unknown (' + CAST(pi.prfown_code AS VARCHAR(20)) + ')') AS profile_name,
                ISNULL(pi.prfgrp_own_code, 0) AS prfgrp_own_code,
                ISNULL(pgo.profile_name, 'None') AS prfgrp_own_name,
                ISNULL(pi.invoice_to, 0) AS invoice_to,
                ISNULL(v.vend_name, 'Unknown (' + CAST(pi.invoice_to AS VARCHAR(20)) + ')') AS invoice_to_name,
                pi.invoice_month,
                ISNULL(pi.total_income_pkr, 0) AS total_income_pkr,
                ISNULL(pi.charged_amt_pkr, 0) AS charged_amt_pkr,
                ISNULL(pi.charged_amt_usd, 0) AS charged_amt_usd,
                pi.ccy,
                pi.status,
                ISNULL(pi.insert_by, '') AS insert_by,
                pi.insert_time,
                pi.project_code,
                ISNULL(p.Proj_name, '') AS project_name,
                ISNULL(st.stack_name, '') AS stack_name,
                ISNULL(p.branch_code, 0) AS branch_code
            FROM dbo.Profile_invoicing pi
            LEFT OUTER JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfown_code
            LEFT OUTER JOIN prof.Profile_Owners pgo ON pgo.PrfOwn_code = pi.prfgrp_own_code
            LEFT OUTER JOIN setups.vendors v ON v.vend_code = pi.invoice_to
            LEFT OUTER JOIN mkt.Projects p ON p.project_code = pi.project_code
            LEFT OUTER JOIN setups.Stacks st ON st.stack_code = p.stack_cde
            WHERE (REPLACE(RTRIM(pi.invoice_month), '-', '') = @m OR RTRIM(pi.invoice_month) = @m)
              AND pi.is_processed = 1";

        if (groupOwnerCode.HasValue && groupOwnerCode.Value > 0)
        {
            sql += " AND (pi.prfgrp_own_code = @grp OR pi.prfown_code = @grp)";
            cmd.Parameters.Add(new SqlParameter("@grp", groupOwnerCode.Value));
        }

        sql += " ORDER BY ISNULL(st.stack_name, 'ZZZ'), ISNULL(p.Proj_name, ''), po.profile_name, pi.cmp_prof_invoice_code";
        cmd.CommandText = sql;
        cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new ProfileInvoiceProcessedRowDto
            {
                CmpProfInvoiceCode = Convert.ToInt64(reader.GetValue(0)),
                PrfownCode = Convert.ToInt32(reader.GetValue(1)),
                ProfileName = reader.GetString(2).Trim(),
                PrfgrpOwnCode = Convert.ToInt32(reader.GetValue(3)),
                PrfgrpOwnName = reader.GetString(4).Trim(),
                InvoiceTo = Convert.ToInt32(reader.GetValue(5)),
                InvoiceToName = reader.GetString(6).Trim(),
                InvoiceMonth = reader.GetString(7).Trim(),
                TotalIncomePkr = Convert.ToDecimal(reader.GetValue(8)),
                ChargedAmtPkr = Convert.ToDecimal(reader.GetValue(9)),
                ChargedAmtUsd = Convert.ToDecimal(reader.GetValue(10)),
                Ccy = reader.IsDBNull(11) ? null : Convert.ToInt32(reader.GetValue(11)),
                Status = reader.IsDBNull(12) ? null : reader.GetString(12).Trim(),
                InsertBy = reader.IsDBNull(13) ? null : reader.GetString(13).Trim(),
                InsertTime = reader.IsDBNull(14) ? null : reader.GetDateTime(14),
                ProjectCode = reader.IsDBNull(15) ? null : Convert.ToInt32(reader.GetValue(15)),
                ProjectName = reader.GetString(16).Trim(),
                Stack = reader.GetString(17).Trim(),
                BranchCode = reader.IsDBNull(18) ? 0 : Convert.ToInt32(reader.GetValue(18)),
                IsForeign = !reader.IsDBNull(18) && Convert.ToInt32(reader.GetValue(18)) == ForeignBranchCode
            });
        }

        return list;
    }

    public async Task<List<ProfileInvoiceProcessedProfileDto>> GetProcessedProfilesAsync(
        string month, int? groupOwnerCode = null, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var list = new List<ProfileInvoiceProcessedProfileDto>();

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        var ownerCodes = new List<int>();
        using (var cmd = conn.CreateCommand())
        {
            string sql = @"
                SELECT DISTINCT 
                    ISNULL(pi.prfgrp_own_code, pi.prfown_code) AS owner_code
                FROM dbo.Profile_invoicing pi
                WHERE (REPLACE(RTRIM(pi.invoice_month), '-', '') = @m OR RTRIM(pi.invoice_month) = @m)
                  AND pi.is_processed = 1
                  AND ISNULL(pi.prfgrp_own_code, pi.prfown_code) > 0";

            if (groupOwnerCode.HasValue && groupOwnerCode.Value > 0)
            {
                sql += " AND (pi.prfgrp_own_code = @grp OR pi.prfown_code = @grp)";
                cmd.Parameters.Add(Param("@grp", groupOwnerCode.Value));
            }

            sql += " ORDER BY owner_code";
            cmd.CommandText = sql;
            cmd.Parameters.Add(Param("@m", cleanMonth));

            using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                ownerCodes.Add(Convert.ToInt32(rdr.GetValue(0)));
            }
        }

        foreach (var oCode in ownerCodes)
        {
            // Grand totals: all processed rows for this owner (excludeToBeDiscussed=false so counts are complete)
            var view = await GetExcelViewAsync(oCode, cleanMonth, processedOnly: true, ct: ct, excludeToBeDiscussed: false);

            // Count and sum directly from DB for accuracy (not filtered by excludeToBeDiscussed)
            int totalInvoiceCount = 0;
            decimal totalUsd = 0;
            using (var cmdSums = conn.CreateCommand())
            {
                cmdSums.CommandText = @"
                    SELECT COUNT(*), ISNULL(SUM(ISNULL(total_usd_cost, 0)), 0)
                    FROM dbo.Profile_invoicing
                    WHERE (prfgrp_own_code = @grp OR prfown_code = @grp)
                      AND (REPLACE(RTRIM(invoice_month), '-', '') = @m OR RTRIM(invoice_month) = @m)
                      AND is_processed = 1";
                cmdSums.Parameters.Add(Param("@grp", oCode));
                cmdSums.Parameters.Add(Param("@m", cleanMonth));
                using var sRdr = await cmdSums.ExecuteReaderAsync(ct);
                if (await sRdr.ReadAsync(ct))
                {
                    totalInvoiceCount = Convert.ToInt32(sRdr.GetValue(0));
                    totalUsd = Convert.ToDecimal(sRdr.GetValue(1));
                }
            }

            var invoiceCodes = view.Rows
                .SelectMany(r => (r.ChildInvoiceCodes ?? new List<long>()).Concat(r.CmpProfInvoiceCode.HasValue ? new[] { r.CmpProfInvoiceCode.Value } : Array.Empty<long>()))
                .Where(c => c > 0)
                .Distinct()
                .ToList();

            if (invoiceCodes.Count == 0)
            {
                using var cmdCodes = conn.CreateCommand();
                cmdCodes.CommandText = @"
                    SELECT cmp_prof_invoice_code 
                    FROM dbo.Profile_invoicing 
                    WHERE (REPLACE(RTRIM(invoice_month), '-', '') = @m OR RTRIM(invoice_month) = @m)
                      AND (prfgrp_own_code = @grp OR prfown_code = @grp)
                      AND is_processed = 1";
                cmdCodes.Parameters.Add(Param("@m", cleanMonth));
                cmdCodes.Parameters.Add(Param("@grp", oCode));
                using var cRdr = await cmdCodes.ExecuteReaderAsync(ct);
                while (await cRdr.ReadAsync(ct))
                {
                    invoiceCodes.Add(Convert.ToInt64(cRdr.GetValue(0)));
                }
            }

            list.Add(new ProfileInvoiceProcessedProfileDto
            {
                OwnerCode = oCode,
                OwnerName = string.IsNullOrWhiteSpace(view.GroupOwnerName) ? $"Owner #{oCode}" : view.GroupOwnerName,
                Month = cleanMonth,
                TotalCost = view.TotalCostSum,
                TotalInvoice = Math.Round(totalUsd, 0),
                TotalActual = view.ActualChargesSum,
                TotalOther = view.OtherChargeSum,
                RowsCount = totalInvoiceCount > 0 ? totalInvoiceCount : invoiceCodes.Count,
                InvoiceCodes = invoiceCodes
            });
        }

        return list.OrderBy(p => p.OwnerName).ToList();
    }

    public async Task<(int UnprocessedCount, decimal UnprocessedUsd, string OwnerName)> GetOwnerUnprocessedStatusAsync(
        int ownerCode, string month, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string ownerName = "";
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT profile_name FROM prof.Profile_Owners WHERE PrfOwn_code = @own";
            cmd.Parameters.Add(new SqlParameter("@own", ownerCode));
            var nameObj = await cmd.ExecuteScalarAsync(ct);
            ownerName = nameObj?.ToString()?.Trim() ?? $"Owner #{ownerCode}";
        }

        int count = 0;
        decimal usd = 0;

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT COUNT(*), ISNULL(SUM(pi.charged_amt_usd), 0)
                FROM dbo.Profile_invoicing pi
                WHERE (pi.prfown_code = @own OR (pi.prfgrp_own_code = @own AND NOT EXISTS (SELECT 1 FROM dbo.Profile_invoicing x WHERE x.prfown_code = @own AND REPLACE(RTRIM(x.invoice_month), '-', '') = @m)))
                  AND REPLACE(RTRIM(pi.invoice_month), '-', '') = @m
                  AND (pi.is_processed = 0 OR pi.is_processed IS NULL)";
            cmd.Parameters.Add(new SqlParameter("@own", ownerCode));
            cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));

            using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                count = rdr.GetInt32(0);
                usd = rdr.GetDecimal(1);
            }
        }

        // Also check if any rows in source tables haven't been generated in dbo.Profile_invoicing yet
        if (count == 0)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT COUNT(*), ISNULL(SUM(ci.charged_amt_usd), 0)
                FROM dbo.Company_invoicing ci
                WHERE ci.prfown_code = @own
                  AND REPLACE(RTRIM(ci.invoice_month), '-', '') = @m
                  AND NOT EXISTS (
                      SELECT 1 FROM dbo.Profile_invoicing pi 
                      WHERE pi.prfown_code = ci.prfown_code 
                        AND REPLACE(RTRIM(pi.invoice_month), '-', '') = @m
                  )";
            cmd.Parameters.Add(new SqlParameter("@own", ownerCode));
            cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));
            using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                int ungenCount = rdr.GetInt32(0);
                if (ungenCount > 0)
                {
                    count += ungenCount;
                    usd += rdr.GetDecimal(1);
                }
            }
        }

        return (count, usd, ownerName);
    }

    public async Task<ProfileInvoiceUnprocessedResult> GetUnprocessedInvoicesAsync(string month, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var result = new ProfileInvoiceUnprocessedResult
        {
            MonthYear = cleanMonth
        };

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        using var cmd = conn.CreateCommand();
        // ── Two-part query:
        // Part 1: Owners whose invoices have been GENERATED but still have UNPROCESSED rows
        //         in dbo.Profile_invoicing (is_processed = 0 / NULL).
        //         Opening an invoice (GenerateAndOpenAsync) only inserts rows with is_processed=0,
        //         so these owners must remain visible in the Unprocessed tab until Save Selected is used.
        // Part 2: Owners whose invoices have NOT yet been generated into Profile_invoicing at all
        //         (they still only exist in the source tables: company_invoicing, interviews, recurring).
        cmd.CommandText = @"
            WITH
            -- ── Generated-but-unprocessed owners ──────────────────────────────────
            GeneratedUnprocessed AS (
                SELECT
                    pi.prfgrp_own_code                        AS prfown_code,
                    REPLACE(RTRIM(pi.invoice_month), '-', '') AS invoice_month,
                    COUNT(*)                                   AS pending_rows,
                    CAST(SUM(ISNULL(pi.charged_amt_usd, 0)) AS DECIMAL(18,2)) AS total_pending_usd,
                    CAST(SUM(CASE WHEN ISNULL(pi.total_usd_cost,0) > 0 THEN pi.total_usd_cost
                                  ELSE ISNULL(pi.charged_amt_usd, 0) END) AS DECIMAL(18,2)) AS total_cost
                FROM dbo.Profile_invoicing pi
                WHERE (REPLACE(RTRIM(pi.invoice_month), '-', '') = @m OR RTRIM(pi.invoice_month) = @m)
                  AND (pi.is_processed = 0 OR pi.is_processed IS NULL)
                  AND pi.prfgrp_own_code IS NOT NULL AND pi.prfgrp_own_code > 0
                GROUP BY pi.prfgrp_own_code, pi.invoice_month
            ),
            -- ── Source-table rows (company + interview + recurring) ────────────────
            SourceAgg AS (
                SELECT 
                    ci.prfown_code,
                    ci.invoice_month,
                    1 AS company_row, 0 AS interview_row, 0 AS recurring_row,
                    ISNULL(ci.charged_amt_usd, 0) AS pending_usd,
                    CASE WHEN ISNULL(ci.total_usd_cost, 0) > 0 THEN ci.total_usd_cost 
                         ELSE ISNULL(ci.charged_amt_usd, 0) END AS cost_usd
                FROM dbo.company_invoicing ci
                WHERE (REPLACE(RTRIM(ci.invoice_month), '-', '') = @m OR RTRIM(ci.invoice_month) = @m)
                  AND (ci.charg_type_code IS NULL OR ci.charg_type_code NOT IN (18, 19, 20, 21, 22, 23, 24, 12, 14, 13))
                  AND ci.prfown_code IS NOT NULL AND ci.prfown_code > 0

                UNION ALL

                SELECT 
                    pii.prfown_code, pii.month_year, 0, 1, 0,
                    CASE WHEN pii.currency_code = 2 THEN ISNULL(pii.paid_amount, 0)
                         WHEN pii.currency_code = 1 AND xr.exch_rate > 0 THEN ROUND(ISNULL(pii.paid_amount, 0) / xr.exch_rate, 0)
                         ELSE ISNULL(pii.paid_amount, 0) END,
                    CASE WHEN pii.currency_code = 2 THEN ISNULL(pii.paid_amount, 0)
                         WHEN pii.currency_code = 1 AND xr.exch_rate > 0 THEN ROUND(ISNULL(pii.paid_amount, 0) / xr.exch_rate, 0)
                         ELSE ISNULL(pii.paid_amount, 0) END
                FROM mkt.profile_int_invoicing pii
                CROSS JOIN (SELECT TOP 1 ISNULL(rate, 278.0) AS exch_rate FROM setups.exchange_rate ORDER BY ExchangeRateCode_code ASC) xr
                WHERE (REPLACE(RTRIM(pii.month_year), '-', '') = @m OR RTRIM(pii.month_year) = @m)
                  AND pii.prfown_code IS NOT NULL AND pii.prfown_code > 0

                UNION ALL

                SELECT 
                    pip.Prfown_code, pip.month_year, 0, 0, 1,
                    CASE WHEN pip.currency_code = 2 THEN ISNULL(pip.amount, 0)
                         WHEN pip.currency_code = 1 AND xr.exch_rate > 0 THEN ROUND(ISNULL(pip.amount, 0) / xr.exch_rate, 0)
                         ELSE ISNULL(pip.amount, 0) END,
                    CASE WHEN pip.currency_code = 2 THEN ISNULL(pip.amount, 0)
                         WHEN pip.currency_code = 1 AND xr.exch_rate > 0 THEN ROUND(ISNULL(pip.amount, 0) / xr.exch_rate, 0)
                         ELSE ISNULL(pip.amount, 0) END
                FROM mkt.prof_int_proj_invoicing pip
                CROSS JOIN (SELECT TOP 1 ISNULL(rate, 278.0) AS exch_rate FROM setups.exchange_rate ORDER BY ExchangeRateCode_code ASC) xr
                WHERE (REPLACE(RTRIM(pip.month_year), '-', '') = @m OR RTRIM(pip.month_year) = @m)
                  AND pip.Prfown_code IS NOT NULL AND pip.Prfown_code > 0
            ),
            -- ── Not-yet-generated: source owners with NO Profile_invoicing rows ───
            NotGenerated AS (
                SELECT 
                    sa.prfown_code,
                    sa.invoice_month,
                    SUM(sa.company_row)  AS company_rows,
                    SUM(sa.interview_row) AS interview_rows,
                    SUM(sa.recurring_row) AS recurring_rows,
                    COUNT(*) AS pending_rows,
                    CAST(SUM(sa.pending_usd) AS DECIMAL(18,2)) AS total_pending_usd,
                    CAST(SUM(sa.cost_usd)    AS DECIMAL(18,2)) AS total_cost
                FROM SourceAgg sa
                WHERE NOT EXISTS (
                    SELECT 1 FROM dbo.Profile_invoicing pi
                    WHERE (pi.prfown_code = sa.prfown_code OR pi.prfgrp_own_code = sa.prfown_code)
                      AND (REPLACE(RTRIM(pi.invoice_month), '-', '') = @m OR RTRIM(pi.invoice_month) = @m)
                )
                GROUP BY sa.prfown_code, sa.invoice_month
            )
            -- ── PART 1: Generated + unprocessed ────────────────────────────────────
            SELECT
                gu.prfown_code,
                ISNULL(po.profile_name, 'Unknown (' + CAST(gu.prfown_code AS VARCHAR(20)) + ')') AS profile_name,
                gu.invoice_month,
                0 AS company_rows, 0 AS interview_rows, 0 AS recurring_rows,
                gu.pending_rows,
                gu.total_pending_usd,
                gu.total_cost
            FROM GeneratedUnprocessed gu
            LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = gu.prfown_code

            UNION ALL

            -- ── PART 2: Not yet generated ──────────────────────────────────────────
            SELECT
                ng.prfown_code,
                ISNULL(po.profile_name, 'Unknown (' + CAST(ng.prfown_code AS VARCHAR(20)) + ')') AS profile_name,
                ng.invoice_month,
                ng.company_rows, ng.interview_rows, ng.recurring_rows,
                ng.pending_rows,
                ng.total_pending_usd,
                ng.total_cost
            FROM NotGenerated ng
            LEFT JOIN prof.Profile_Owners po ON po.PrfOwn_code = ng.prfown_code
            ORDER BY profile_name, prfown_code";
        cmd.Parameters.Add(new SqlParameter("@m", cleanMonth));
        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var row = new ProfileInvoiceUnprocessedRowDto
            {
                PrfownCode = Convert.ToInt32(reader.GetValue(0)),
                ProfileName = reader.GetString(1).Trim(),
                InvoiceMonth = reader.GetString(2).Trim(),
                CompanyRows = Convert.ToInt32(reader.GetValue(3)),
                InterviewRows = Convert.ToInt32(reader.GetValue(4)),
                RecurringRows = Convert.ToInt32(reader.GetValue(5)),
                PendingRows = Convert.ToInt32(reader.GetValue(6)),
                TotalPendingUsd = Convert.ToDecimal(reader.GetValue(7)),
                TotalCost = Convert.ToDecimal(reader.GetValue(8))
            };
            result.Rows.Add(row);
        }

        result.TotalUnprocessedOwners = result.Rows.Count;
        result.TotalPendingRows = result.Rows.Sum(r => r.PendingRows);
        result.TotalPendingUsd = result.Rows.Sum(r => r.TotalPendingUsd);
        result.TotalCostSum = result.Rows.Sum(r => r.TotalCost);

        return result;
    }

    public async Task<List<ProfileInvoiceAuditLogDto>> GetAuditLogsAsync(
        string? month = null, int? groupOwnerCode = null, long? cmpProfInvoiceCode = null, CancellationToken ct = default)
    {
        var list = new List<ProfileInvoiceAuditLogDto>();
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        using var cmd = conn.CreateCommand();
        string sql = @"
            SELECT 
                al.id,
                al.username,
                al.timestamp,
                al.invoice_month,
                al.cmp_prof_invoice_code,
                al.project_code,
                al.field_name,
                al.old_value,
                al.new_value,
                al.is_month_finalized,
                ISNULL(p.Proj_name, '') AS project_name,
                ISNULL(st.stack_name, '') AS stack_name,
                ISNULL(p.branch_code, 0) AS branch_code
            FROM dbo.profile_invoice_audit_log al
            LEFT OUTER JOIN mkt.Projects p ON p.project_code = al.project_code
            LEFT OUTER JOIN setups.Stacks st ON st.stack_code = p.stack_cde
            WHERE 1 = 1";

        if (!string.IsNullOrWhiteSpace(month))
        {
            string clean = month.Trim().Replace("-", "").ToUpperInvariant();
            sql += " AND (REPLACE(RTRIM(al.invoice_month), '-', '') = @m OR RTRIM(al.invoice_month) = @m)";
            cmd.Parameters.Add(Param("@m", clean));
        }

        if (cmpProfInvoiceCode.HasValue && cmpProfInvoiceCode.Value > 0)
        {
            sql += " AND al.cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(Param("@code", cmpProfInvoiceCode.Value));
        }

        if (groupOwnerCode.HasValue && groupOwnerCode.Value > 0)
        {
            sql += @" AND (
                al.cmp_prof_invoice_code IN (SELECT cmp_prof_invoice_code FROM dbo.Profile_invoicing WHERE prfgrp_own_code = @grp)
                OR al.project_code IN (SELECT project_code FROM dbo.Profile_invoicing WHERE prfgrp_own_code = @grp)
            )";
            cmd.Parameters.Add(Param("@grp", groupOwnerCode.Value));
        }

        sql += " ORDER BY al.timestamp DESC, al.id DESC";
        cmd.CommandText = sql;

        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new ProfileInvoiceAuditLogDto
            {
                Id = reader.GetInt32(0),
                Username = reader.GetString(1).Trim(),
                Timestamp = reader.GetDateTime(2),
                InvoiceMonth = reader.GetString(3).Trim(),
                CmpProfInvoiceCode = reader.IsDBNull(4) ? null : reader.GetInt64(4),
                ProjectCode = reader.IsDBNull(5) ? null : reader.GetInt32(5),
                FieldName = reader.GetString(6).Trim(),
                OldValue = reader.IsDBNull(7) ? null : reader.GetString(7),
                NewValue = reader.IsDBNull(8) ? null : reader.GetString(8),
                IsMonthFinalized = reader.GetBoolean(9),
                ProjectName = reader.GetString(10).Trim(),
                Stack = reader.GetString(11).Trim(),
                BranchCode = reader.IsDBNull(12) ? 0 : Convert.ToInt32(reader.GetValue(12)),
                IsForeign = !reader.IsDBNull(12) && Convert.ToInt32(reader.GetValue(12)) == ForeignBranchCode
            });
        }

        return list;
    }

    public async Task<List<ProfileInvoiceDiscussedRowDto>> GetDiscussedInvoicesAsync(
        string month, int? groupOwnerCode = null, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var list = new List<ProfileInvoiceDiscussedRowDto>();

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        using var cmd = conn.CreateCommand();
        string sql = @"
            SELECT 
                pi.cmp_prof_invoice_code,
                pi.prfown_code,
                ISNULL(po.profile_name, 'Unknown') AS profile_name,
                ISNULL(pi.prfgrp_own_code, 0) AS prfgrp_own_code,
                ISNULL(pgo.profile_name, 'None') AS prfgrp_own_name,
                pi.project_code,
                ISNULL(p.Proj_name, '') AS project_name,
                ISNULL(pi.remarks, '') AS remarks,
                pi.invoice_month,
                ISNULL(pi.charged_amt_usd, 0) AS charged_amt_usd,
                ISNULL(pi.total_usd_cost, 0) AS total_usd_cost,
                ISNULL(pi.status, 'P') AS status,
                ISNULL(pi.is_included, 1) AS is_included,
                ISNULL(pi.invoice_number, '') AS invoice_number,
                ISNULL(pi.to_be_discussed, 0) AS to_be_discussed,
                pi.discuss_note,
                pi.discuss_marked_by,
                pi.discuss_marked_time,
                ISNULL(pi.last_modified_by, ISNULL(pi.insert_by, '')) AS last_modified_by,
                ISNULL(pi.last_modified_time, pi.insert_time) AS last_modified_time,
                ISNULL(st.stack_name, '') AS stack_name,
                ISNULL(p.branch_code, 0) AS branch_code
            FROM dbo.Profile_invoicing pi
            LEFT OUTER JOIN prof.Profile_Owners po ON po.PrfOwn_code = pi.prfown_code
            LEFT OUTER JOIN prof.Profile_Owners pgo ON pgo.PrfOwn_code = pi.prfgrp_own_code
            LEFT OUTER JOIN mkt.Projects p ON p.project_code = pi.project_code
            LEFT OUTER JOIN setups.Stacks st ON st.stack_code = p.stack_cde
            WHERE (REPLACE(RTRIM(pi.invoice_month), '-', '') = @m OR RTRIM(pi.invoice_month) = @m)
              AND ISNULL(pi.to_be_discussed, 0) = 1";

        if (groupOwnerCode.HasValue && groupOwnerCode.Value > 0)
        {
            sql += " AND pi.prfgrp_own_code = @grp";
            cmd.Parameters.Add(Param("@grp", groupOwnerCode.Value));
        }

        sql += " ORDER BY ISNULL(st.stack_name, 'ZZZ'), ISNULL(p.Proj_name, ''), po.profile_name, pi.cmp_prof_invoice_code";
        cmd.CommandText = sql;
        cmd.Parameters.Add(Param("@m", cleanMonth));

        using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new ProfileInvoiceDiscussedRowDto
            {
                CmpProfInvoiceCode = Convert.ToInt64(reader.GetValue(0)),
                PrfownCode = Convert.ToInt32(reader.GetValue(1)),
                ProfileName = reader.GetString(2).Trim(),
                PrfgrpOwnCode = Convert.ToInt32(reader.GetValue(3)),
                PrfgrpOwnName = reader.GetString(4).Trim(),
                ProjectCode = reader.IsDBNull(5) ? null : Convert.ToInt32(reader.GetValue(5)),
                ProjectName = reader.GetString(6).Trim(),
                ServiceHead = reader.GetString(7).Trim(),
                InvoiceMonth = reader.GetString(8).Trim(),
                ChargedAmtUsd = Convert.ToDecimal(reader.GetValue(9)),
                TotalCost = Convert.ToDecimal(reader.GetValue(10)),
                Status = reader.GetString(11).Trim(),
                IsIncluded = Convert.ToBoolean(reader.GetValue(12)),
                InvoiceNumber = reader.IsDBNull(13) ? "" : reader.GetString(13).Trim(),
                ToBeDiscussed = Convert.ToBoolean(reader.GetValue(14)),
                DiscussNote = reader.IsDBNull(15) ? null : reader.GetString(15).Trim(),
                DiscussMarkedBy = reader.IsDBNull(16) ? null : reader.GetString(16).Trim(),
                DiscussMarkedTime = reader.IsDBNull(17) ? null : reader.GetDateTime(17),
                LastModifiedBy = reader.IsDBNull(18) ? "" : reader.GetString(18).Trim(),
                LastModifiedTime = reader.IsDBNull(19) ? null : reader.GetDateTime(19),
                Stack = reader.GetString(20).Trim(),
                BranchCode = reader.IsDBNull(21) ? 0 : Convert.ToInt32(reader.GetValue(21)),
                IsForeign = !reader.IsDBNull(21) && Convert.ToInt32(reader.GetValue(21)) == ForeignBranchCode
            });
        }

        return list;
    }

    public async Task<(bool Success, string Message, int UpdatedCount)> AddToBeDiscussedAsync(
        List<long> codes, string? note, string username, CancellationToken ct = default)
    {
        if (codes == null || codes.Count == 0)
            return (false, "No invoice codes provided.", 0);

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string userLog = string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username);
        string? cleanNote = string.IsNullOrWhiteSpace(note) ? null : (note.Trim().Length > 500 ? note.Trim().Substring(0, 500) : note.Trim());

        int updatedCount = 0;
        foreach (var code in codes.Distinct())
        {
            // 1. Fetch current row state
            bool exists = false;
            string invoiceMonth = "";
            bool currToBeDiscussed = false;
            string? currNote = null;

            using (var cmdFetch = conn.CreateCommand())
            {
                cmdFetch.CommandText = @"
                    SELECT invoice_month, ISNULL(to_be_discussed, 0), discuss_note 
                    FROM dbo.Profile_invoicing 
                    WHERE cmp_prof_invoice_code = @code";
                cmdFetch.Parameters.Add(Param("@code", code));
                using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    exists = true;
                    invoiceMonth = rdr.GetString(0).Trim();
                    currToBeDiscussed = rdr.GetBoolean(1);
                    currNote = rdr.IsDBNull(2) ? null : rdr.GetString(2).Trim();
                }
            }

            if (!exists) continue;

            bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

            // 2. Only update & audit if value changed or note updated
            if (!currToBeDiscussed)
            {
                using (var cmdUpd = conn.CreateCommand())
                {
                    cmdUpd.CommandText = @"
                        UPDATE dbo.Profile_invoicing
                        SET to_be_discussed = 1,
                            discuss_note = @note,
                            discuss_marked_by = @user,
                            discuss_marked_time = SYSUTCDATETIME(),
                            last_modified_by = @user,
                            last_modified_time = GETDATE()
                        WHERE cmp_prof_invoice_code = @code";
                    cmdUpd.Parameters.Add(ParamOrNull("@note", cleanNote, 500));
                    cmdUpd.Parameters.Add(Param("@user", userLog));
                    cmdUpd.Parameters.Add(Param("@code", code));
                    await cmdUpd.ExecuteNonQueryAsync(ct);
                }

                // Audit log for to_be_discussed flag change
                using (var cmdAudit = conn.CreateCommand())
                {
                    cmdAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @code, 'to_be_discussed', '0', '1', @isFinalized)";
                    cmdAudit.Parameters.Add(Param("@user", userLog));
                    cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
                    cmdAudit.Parameters.Add(Param("@code", code));
                    cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdAudit.ExecuteNonQueryAsync(ct);
                }

                if (!string.IsNullOrWhiteSpace(cleanNote))
                {
                    using var cmdNoteAudit = conn.CreateCommand();
                    cmdNoteAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @code, 'discuss_note', NULL, @newNote, @isFinalized)";
                    cmdNoteAudit.Parameters.Add(Param("@user", userLog));
                    cmdNoteAudit.Parameters.Add(Param("@m", invoiceMonth));
                    cmdNoteAudit.Parameters.Add(Param("@code", code));
                    cmdNoteAudit.Parameters.Add(Param("@newNote", cleanNote));
                    cmdNoteAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdNoteAudit.ExecuteNonQueryAsync(ct);
                }

                updatedCount++;
            }
            else if (cleanNote != null && cleanNote != currNote)
            {
                // Already in To Be Discussed, but note updated
                using (var cmdUpd = conn.CreateCommand())
                {
                    cmdUpd.CommandText = @"
                        UPDATE dbo.Profile_invoicing
                        SET discuss_note = @note,
                            last_modified_by = @user,
                            last_modified_time = GETDATE()
                        WHERE cmp_prof_invoice_code = @code";
                    cmdUpd.Parameters.Add(ParamOrNull("@note", cleanNote, 500));
                    cmdUpd.Parameters.Add(Param("@user", userLog));
                    cmdUpd.Parameters.Add(Param("@code", code));
                    await cmdUpd.ExecuteNonQueryAsync(ct);
                }

                using var cmdNoteAudit = conn.CreateCommand();
                cmdNoteAudit.CommandText = @"
                    INSERT INTO dbo.profile_invoice_audit_log 
                        (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                    VALUES 
                        (@user, SYSUTCDATETIME(), @m, @code, 'discuss_note', @oldNote, @newNote, @isFinalized)";
                cmdNoteAudit.Parameters.Add(Param("@user", userLog));
                cmdNoteAudit.Parameters.Add(Param("@m", invoiceMonth));
                cmdNoteAudit.Parameters.Add(Param("@code", code));
                cmdNoteAudit.Parameters.Add(ParamOrNull("@oldNote", currNote));
                cmdNoteAudit.Parameters.Add(Param("@newNote", cleanNote));
                cmdNoteAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                await cmdNoteAudit.ExecuteNonQueryAsync(ct);
            }
        }

        return (true, $"Marked {updatedCount} invoice(s) for discussion.", updatedCount);
    }

    public async Task<(bool Success, string Message, int UpdatedCount)> RemoveFromToBeDiscussedAsync(
        List<long> codes, string username, CancellationToken ct = default)
    {
        if (codes == null || codes.Count == 0)
            return (false, "No invoice codes provided.", 0);

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string userLog = string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username);

        int updatedCount = 0;
        foreach (var code in codes.Distinct())
        {
            bool exists = false;
            string invoiceMonth = "";
            bool currToBeDiscussed = false;

            using (var cmdFetch = conn.CreateCommand())
            {
                cmdFetch.CommandText = @"
                    SELECT invoice_month, ISNULL(to_be_discussed, 0)
                    FROM dbo.Profile_invoicing 
                    WHERE cmp_prof_invoice_code = @code";
                cmdFetch.Parameters.Add(Param("@code", code));
                using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    exists = true;
                    invoiceMonth = rdr.GetString(0).Trim();
                    currToBeDiscussed = rdr.GetBoolean(1);
                }
            }

            if (!exists || !currToBeDiscussed) continue;

            bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

            using (var cmdUpd = conn.CreateCommand())
            {
                cmdUpd.CommandText = @"
                    UPDATE dbo.Profile_invoicing
                    SET to_be_discussed = 0,
                        last_modified_by = @user,
                        last_modified_time = GETDATE()
                    WHERE cmp_prof_invoice_code = @code";
                cmdUpd.Parameters.Add(Param("@user", userLog));
                cmdUpd.Parameters.Add(Param("@code", code));
                await cmdUpd.ExecuteNonQueryAsync(ct);
            }

            // Audit log for to_be_discussed removal
            using (var cmdAudit = conn.CreateCommand())
            {
                cmdAudit.CommandText = @"
                    INSERT INTO dbo.profile_invoice_audit_log 
                        (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                    VALUES 
                        (@user, SYSUTCDATETIME(), @m, @code, 'to_be_discussed', '1', '0', @isFinalized)";
                cmdAudit.Parameters.Add(Param("@user", userLog));
                cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
                cmdAudit.Parameters.Add(Param("@code", code));
                cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                await cmdAudit.ExecuteNonQueryAsync(ct);
            }

            updatedCount++;
        }

        return (true, $"Removed {updatedCount} invoice(s) from To Be Discussed.", updatedCount);
    }

    public async Task<(bool Success, string Message)> UpdateDiscussNoteAsync(
        long code, string? note, string username, CancellationToken ct = default)
    {
        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string userLog = string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username);
        string? cleanNote = string.IsNullOrWhiteSpace(note) ? null : (note.Trim().Length > 500 ? note.Trim().Substring(0, 500) : note.Trim());

        string invoiceMonth = "";
        string? currNote = null;
        using (var cmdFetch = conn.CreateCommand())
        {
            cmdFetch.CommandText = "SELECT invoice_month, discuss_note FROM dbo.Profile_invoicing WHERE cmp_prof_invoice_code = @code";
            cmdFetch.Parameters.Add(Param("@code", code));
            using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                invoiceMonth = rdr.GetString(0).Trim();
                currNote = rdr.IsDBNull(1) ? null : rdr.GetString(1).Trim();
            }
            else
            {
                return (false, $"Invoice #{code} not found.");
            }
        }

        if (cleanNote == currNote)
            return (true, "No change in note.");

        bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

        using (var cmdUpd = conn.CreateCommand())
        {
            cmdUpd.CommandText = @"
                UPDATE dbo.Profile_invoicing 
                SET discuss_note = @note,
                    last_modified_by = @user,
                    last_modified_time = GETDATE()
                WHERE cmp_prof_invoice_code = @code";
            cmdUpd.Parameters.Add(ParamOrNull("@note", cleanNote, 500));
            cmdUpd.Parameters.Add(Param("@user", userLog));
            cmdUpd.Parameters.Add(Param("@code", code));
            await cmdUpd.ExecuteNonQueryAsync(ct);
        }

        using (var cmdAudit = conn.CreateCommand())
        {
            cmdAudit.CommandText = @"
                INSERT INTO dbo.profile_invoice_audit_log 
                    (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                VALUES 
                    (@user, SYSUTCDATETIME(), @m, @code, 'discuss_note', @oldNote, @newNote, @isFinalized)";
            cmdAudit.Parameters.Add(Param("@user", userLog));
            cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
            cmdAudit.Parameters.Add(Param("@code", code));
            cmdAudit.Parameters.Add(ParamOrNull("@oldNote", currNote));
            cmdAudit.Parameters.Add(ParamOrNull("@newNote", cleanNote));
            cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
            await cmdAudit.ExecuteNonQueryAsync(ct);
        }

        return (true, "Discuss note updated.");
    }

    public async Task<(bool Success, string Message, int UpdatedCount)> ProcessInvoicesAsync(
        List<long> codes, string username, CancellationToken ct = default)
    {
        if (codes == null || codes.Count == 0)
            return (false, "No invoice codes provided.", 0);

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string userLog = string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username);
        int updatedCount = 0;

        foreach (var code in codes.Distinct())
        {
            bool exists = false;
            string invoiceMonth = "";
            bool currIsProcessed = false;
            string currStatus = "";

            using (var cmdFetch = conn.CreateCommand())
            {
                cmdFetch.CommandText = @"
                    SELECT invoice_month, ISNULL(is_processed, 0), ISNULL(status, '')
                    FROM dbo.Profile_invoicing 
                    WHERE cmp_prof_invoice_code = @code";
                cmdFetch.Parameters.Add(Param("@code", code));
                using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    exists = true;
                    invoiceMonth = rdr.GetString(0).Trim();
                    currIsProcessed = rdr.GetBoolean(1);
                    currStatus = rdr.GetString(2).Trim();
                }
            }

            if (!exists) continue;

            bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

            if (!currIsProcessed || currStatus != "P")
            {
                using (var cmdUpd = conn.CreateCommand())
                {
                    cmdUpd.CommandText = @"
                        UPDATE dbo.Profile_invoicing
                        SET is_processed = 1,
                            status = 'P',
                            last_modified_by = @user,
                            last_modified_time = GETDATE()
                        WHERE cmp_prof_invoice_code = @code";
                    cmdUpd.Parameters.Add(Param("@user", userLog));
                    cmdUpd.Parameters.Add(Param("@code", code));
                    await cmdUpd.ExecuteNonQueryAsync(ct);
                }

                // Audit log for is_processed change
                using (var cmdAudit = conn.CreateCommand())
                {
                    cmdAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @code, 'is_processed', @oldVal, '1', @isFinalized)";
                    cmdAudit.Parameters.Add(Param("@user", userLog));
                    cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
                    cmdAudit.Parameters.Add(Param("@code", code));
                    cmdAudit.Parameters.Add(Param("@oldVal", currIsProcessed ? "1" : "0"));
                    cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdAudit.ExecuteNonQueryAsync(ct);
                }

                updatedCount++;
            }
        }

        return (true, $"{updatedCount} invoice(s) processed successfully.", updatedCount);
    }

    public async Task<(bool Success, string Message, int UpdatedCount)> ProcessInvoicesByOwnerAsync(
        List<int> prfownCodes, string month, string username, CancellationToken ct = default)
    {
        if (prfownCodes == null || prfownCodes.Count == 0)
            return (false, "No owner codes provided.", 0);
        if (string.IsNullOrWhiteSpace(month))
            return (false, "Month is required.", 0);

        string cleanMonth = month.Trim().Replace("-", "").ToUpperInvariant();

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        // Build IN clause safely using parameter per code
        var paramNames = prfownCodes.Select((_, i) => $"@own{i}").ToList();
        string inClause = string.Join(",", paramNames);

        var codes = new List<long>();
        using (var cmdFetch = conn.CreateCommand())
        {
            cmdFetch.CommandText = $@"
                SELECT cmp_prof_invoice_code
                FROM dbo.Profile_invoicing
                WHERE (prfown_code IN ({inClause}) OR prfgrp_own_code IN ({inClause}))
                  AND (REPLACE(RTRIM(invoice_month), '-', '') = @m OR RTRIM(invoice_month) = @m)
                  AND ISNULL(is_processed, 0) = 0";
            cmdFetch.Parameters.Add(Param("@m", cleanMonth));
            for (int i = 0; i < prfownCodes.Count; i++)
                cmdFetch.Parameters.Add(Param(paramNames[i], prfownCodes[i]));

            using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                codes.Add(rdr.GetInt64(0));
        }

        if (codes.Count == 0)
            return (true, "No unprocessed invoices found for the selected owners.", 0);

        return await ProcessInvoicesAsync(codes, username, ct);
    }

    public async Task<(bool Success, string Message, int UpdatedCount)> UnprocessInvoicesAsync(
        List<long> codes, string username, CancellationToken ct = default)
    {
        if (codes == null || codes.Count == 0)
            return (false, "No invoice codes provided.", 0);

        var conn = _db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);

        string userLog = string.IsNullOrWhiteSpace(username) ? "System" : (username.Length > 20 ? username.Substring(0, 20) : username);
        int updatedCount = 0;

        foreach (var code in codes.Distinct())
        {
            bool exists = false;
            string invoiceMonth = "";
            bool currIsProcessed = false;

            using (var cmdFetch = conn.CreateCommand())
            {
                cmdFetch.CommandText = @"
                    SELECT invoice_month, ISNULL(is_processed, 0)
                    FROM dbo.Profile_invoicing 
                    WHERE cmp_prof_invoice_code = @code";
                cmdFetch.Parameters.Add(Param("@code", code));
                using var rdr = await cmdFetch.ExecuteReaderAsync(ct);
                if (await rdr.ReadAsync(ct))
                {
                    exists = true;
                    invoiceMonth = rdr.GetString(0).Trim();
                    currIsProcessed = rdr.GetBoolean(1);
                }
            }

            if (!exists) continue;

            bool isFinalized = await IsMonthFinalizedAsync(invoiceMonth, ct);

            if (currIsProcessed)
            {
                using (var cmdUpd = conn.CreateCommand())
                {
                    cmdUpd.CommandText = @"
                        UPDATE dbo.Profile_invoicing
                        SET is_processed = 0,
                            last_modified_by = @user,
                            last_modified_time = GETDATE()
                        WHERE cmp_prof_invoice_code = @code";
                    cmdUpd.Parameters.Add(Param("@user", userLog));
                    cmdUpd.Parameters.Add(Param("@code", code));
                    await cmdUpd.ExecuteNonQueryAsync(ct);
                }

                using (var cmdAudit = conn.CreateCommand())
                {
                    cmdAudit.CommandText = @"
                        INSERT INTO dbo.profile_invoice_audit_log 
                            (username, timestamp, invoice_month, cmp_prof_invoice_code, field_name, old_value, new_value, is_month_finalized)
                        VALUES 
                            (@user, SYSUTCDATETIME(), @m, @code, 'is_processed', '1', '0', @isFinalized)";
                    cmdAudit.Parameters.Add(Param("@user", userLog));
                    cmdAudit.Parameters.Add(Param("@m", invoiceMonth));
                    cmdAudit.Parameters.Add(Param("@code", code));
                    cmdAudit.Parameters.Add(Param("@isFinalized", isFinalized));
                    await cmdAudit.ExecuteNonQueryAsync(ct);
                }

                updatedCount++;
            }
        }

        return (true, $"{updatedCount} invoice(s) moved back to active.", updatedCount);
    }

    public async Task<List<string>> GetInvoicedMonthsAsync(int? groupOwnerCode = null, CancellationToken ct = default)
    {
        var months = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // 1. Standard invoicing months for current year up to previous completed month:
        // In November (month 11) 2026: now.Month - 1 = 10 (OCT) -> JAN26 to OCT26.
        // In December (month 12) 2026: now.Month - 1 = 11 (NOV) -> JAN26 to NOV26.
        // In January (month 1) 2027: now.Month - 1 = 0 -> include all 12 months of previous year (JAN26 to DEC26).
        var now = DateTime.Now;
        int currentYear = now.Year;
        string yearSuffix = (currentYear % 100).ToString("D2");
        string[] monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

        int maxMonth = now.Month - 1;
        if (maxMonth < 1)
        {
            string prevYearSuffix = ((currentYear - 1) % 100).ToString("D2");
            for (int m = 1; m <= 12; m++)
            {
                months.Add($"{monthNames[m - 1]}{prevYearSuffix}");
            }
        }
        else
        {
            if (maxMonth > 12) maxMonth = 12;
            for (int m = 1; m <= maxMonth; m++)
            {
                months.Add($"{monthNames[m - 1]}{yearSuffix}");
            }
        }

        // 2. Also include any distinct months present in dbo.Profile_invoicing
        try
        {
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open)
            {
                await conn.OpenAsync(ct);
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT DISTINCT REPLACE(RTRIM(invoice_month), '-', '') AS m
                FROM dbo.Profile_invoicing
                WHERE invoice_month IS NOT NULL AND LTRIM(RTRIM(invoice_month)) <> ''";

            using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                if (!reader.IsDBNull(0))
                {
                    string raw = reader.GetString(0).Trim().ToUpperInvariant();
                    if (!string.IsNullOrEmpty(raw))
                    {
                        months.Add(raw);
                    }
                }
            }
        }
        catch
        {
            // If DB query fails, fallback to generated months
        }

        // Return sorted chronologically: JAN26, FEB26, ... OCT26
        return months.OrderBy(m => ParseMonthYearSortKey(m)).ToList();
    }

    private static int ParseMonthYearSortKey(string monthYear)
    {
        if (string.IsNullOrWhiteSpace(monthYear)) return 0;
        string clean = monthYear.Trim().Replace("-", "").ToUpperInvariant();
        if (clean.Length < 5) return 0;

        string mPart = clean.Substring(0, 3);
        string yPart = clean.Substring(3);

        int monthNum = mPart switch
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
            _ => 0
        };

        if (int.TryParse(yPart, out int yr))
        {
            int fullYear = yr < 100 ? (2000 + yr) : yr;
            return fullYear * 100 + monthNum;
        }

        return monthNum;
    }

    /// <summary>
    /// Generate (save) invoices for the given prfown_code + month if not already generated,
    /// then return the Excel view. Safe to call repeatedly — skips generation if rows exist.
    /// </summary>
    public async Task<ProfileInvoiceGenerateOpenResult> GenerateAndOpenAsync(
        int prfownCode, string month, string username, CancellationToken ct = default)
    {
        string cleanMonth = (month ?? "").Trim().Replace("-", "").ToUpperInvariant();
        var result = new ProfileInvoiceGenerateOpenResult();

        var conn = _db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open)
            await conn.OpenAsync(ct);

        // 1. Resolve the group owner code for this individual prfown_code.
        //    If the owner has no parent (ParentProfile_code IS NULL or = 0), it IS the group owner.
        //    Otherwise walk up one level to its parent.
        int groupOwnerCode = prfownCode;
        string groupOwnerName = "";

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT po.PrfOwn_code, po.profile_name,
                       ISNULL(po.ParentProfile_code, 0) AS parent_code,
                       ISNULL(parent.PrfOwn_code, 0)   AS resolved_grp,
                       ISNULL(parent.profile_name, '')  AS resolved_grp_name
                FROM prof.Profile_Owners po
                LEFT JOIN prof.Profile_Owners parent ON parent.PrfOwn_code = po.ParentProfile_code
                WHERE po.PrfOwn_code = @p";
            cmd.Parameters.Add(Param("@p", prfownCode));

            using var rdr = await cmd.ExecuteReaderAsync(ct);
            if (await rdr.ReadAsync(ct))
            {
                int parentCode = rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2);
                if (parentCode > 0 && parentCode != prfownCode)
                {
                    // This is a child — use parent as group owner
                    groupOwnerCode = rdr.IsDBNull(3) ? prfownCode : rdr.GetInt32(3);
                    groupOwnerName = rdr.IsDBNull(4) ? "" : rdr.GetString(4).Trim();
                }
                else
                {
                    // This IS a group owner (or standalone owner with no parent)
                    groupOwnerCode = prfownCode;
                    groupOwnerName = rdr.IsDBNull(1) ? $"Owner #{prfownCode}" : rdr.GetString(1).Trim();
                }
            }
            else
            {
                result.Success = false;
                result.Message = $"Profile owner {prfownCode} not found.";
                return result;
            }
        }

        result.GroupOwnerCode = groupOwnerCode;
        result.GroupOwnerName = groupOwnerName;

        // 2. Check if Profile_invoicing rows already exist for this group owner + month
        bool alreadyExists = false;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT COUNT(*)
                FROM dbo.Profile_invoicing
                WHERE prfgrp_own_code = @grp
                  AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
            cmd.Parameters.Add(Param("@grp", groupOwnerCode));
            cmd.Parameters.Add(Param("@m", cleanMonth));
            var cnt = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0);
            alreadyExists = cnt > 0;
        }

        result.AlreadyExisted = alreadyExists;

        if (!alreadyExists)
        {
            // 3. Generate (save) invoices — calls CalculateDryRunAsync_Internal + inserts rows
            var saveReq = new ProfileInvoiceSaveRequest
            {
                GroupOwnerCode = groupOwnerCode,
                MonthYear      = cleanMonth,
                InsertedBy     = string.IsNullOrWhiteSpace(username) ? "System" : username
            };

            var saveRes = await SaveAsync(saveReq, ct);

            if (!saveRes.Success)
            {
                // If another concurrent request beat us (409-style), that's fine — rows now exist
                if (saveRes.ErrorMessage?.Contains("already exist") == true)
                {
                    alreadyExists = true;
                    result.AlreadyExisted = true;
                    result.RowsGenerated = 0;
                    result.Message = "Invoices already existed (concurrent generation detected). Loading existing rows.";
                }
                else if (saveRes.ErrorMessage?.Contains("Nothing to save") == true ||
                         saveRes.ErrorMessage?.Contains("No rows calculated") == true)
                {
                    result.Success = false;
                    result.Message = saveRes.ErrorMessage ?? "No invoice rows could be calculated for this owner and month. Please verify data in Company Invoicing.";
                    return result;
                }
                else
                {
                    result.Success = false;
                    result.Message = saveRes.ErrorMessage ?? "Failed to generate invoices.";
                    return result;
                }
            }
            else
            {
                result.RowsGenerated = saveRes.RowsInserted;
                result.Message = $"Generated {saveRes.RowsInserted} invoice row(s) for {groupOwnerName} / {cleanMonth}.";
            }
        }
        else
        {
            result.Message = $"Loaded existing invoice rows for {groupOwnerName} / {cleanMonth}.";
        }

        // 4. Load and return the Excel view for the resolved group owner + month
        try
        {
            result.ExcelView = await GetExcelViewAsync(groupOwnerCode, cleanMonth, ct);
            result.Success = true;
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Message = $"Invoices generated but failed to load Excel view: {ex.Message}";
        }

        return result;
    }

    // ── SQL parameter helpers ─────────────────────────────────────────────────

    private static SqlParameter Param(string name, object? value)
        => new(name, value ?? DBNull.Value);

    private static SqlParameter ParamOrNull<T>(string name, T? value) where T : struct
        => new(name, value.HasValue ? (object)value.Value : DBNull.Value);

    private static SqlParameter ParamOrNull(string name, string? value, int maxLen = 0)
    {
        if (value is null) return new(name, DBNull.Value);
        if (maxLen > 0 && value.Length > maxLen) value = value.Substring(0, maxLen);
        return new(name, value);
    }
}

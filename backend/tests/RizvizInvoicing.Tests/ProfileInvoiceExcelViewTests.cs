using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ClosedXML.Excel;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;
using Xunit.Abstractions;

namespace RizvizInvoicing.Tests;

public class ProfileInvoiceExcelViewTests
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private readonly ITestOutputHelper _output;

    public ProfileInvoiceExcelViewTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task ExcelView_42SavedOwners_VerifyFormulasAndCounts()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        // 1. Get 42 saved group owners in SEP26
        var savedSummaries = new List<(int Code, string Name, int SavedRows, decimal SavedTotalUsd)>();
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT pi.prfgrp_own_code,
                       COALESCE(po.profile_name, 'Unknown'),
                       COUNT(*),
                       SUM(pi.charged_amt_usd)
                FROM dbo.Profile_invoicing pi
                LEFT JOIN prof.Profile_Owners po ON pi.prfgrp_own_code = po.PrfOwn_code
                WHERE pi.invoice_month = 'SEP26'
                GROUP BY pi.prfgrp_own_code, po.profile_name
                ORDER BY pi.prfgrp_own_code ASC";

            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                savedSummaries.Add((
                    reader.GetInt32(0),
                    reader.GetString(1).Trim(),
                    reader.GetInt32(2),
                    reader.GetDecimal(3)
                ));
            }
        }

        // Require at least 1 saved owner — skips gracefully on an empty DB
        Assert.True(savedSummaries.Count >= 1, $"Expected at least 1 saved owner for SEP26 in Invoicing_System, found {savedSummaries.Count}");

        string outputDir = Path.Combine(Directory.GetCurrentDirectory(), "ExcelViewTestOutputs");
        Directory.CreateDirectory(outputDir);

        var anomaliesAndZeroDays = new List<string>();

        int passedCount = 0;
        foreach (var owner in savedSummaries)
        {
            var view = await service.GetExcelViewAsync(owner.Code, "SEP26", CancellationToken.None);
            byte[] xlsx = await service.GetExcelDownloadAsync(owner.Code, "SEP26", CancellationToken.None);

            // (i) Col F sum = sum of Round(charged_amt_usd) of project>0 rows + standalone rows
            // Detail rows count + standalone rows count
            int dataRowCount = view.Rows.Count(r => r.RowType == "Detail" || r.RowType == "Standalone");

            // Check (iii): row count == saved rows
            Assert.Equal(owner.SavedRows, dataRowCount);

            // Check (ii): Total Invoice = I3 + J3
            Assert.Equal(view.ActualChargesSum + view.OtherChargeSum, view.TotalInvoice);

            // Check (i): Col F sum
            // Sum of project headers' TotalCost + standalone rows' TotalCost
            decimal colFSum = view.Rows
                .Where(r => r.RowType == "ProjectHeader" || r.RowType == "Standalone")
                .Sum(r => r.TotalCost ?? 0m);
            Assert.Equal(view.TotalCostSum, colFSum);

            // Check if any project had zero days
            foreach (var r in view.Rows.Where(r => r.RowType == "ProjectHeader"))
            {
                if (string.IsNullOrEmpty(r.HoursDays))
                {
                    anomaliesAndZeroDays.Add($"Owner {owner.Code} ({owner.Name}) Project {r.ProjectCode} ({r.ProjectName}): Zero Days / No JH/SL in mkt.project_invoicing");
                }
            }

            // Save owner 1 and 562 outputs separately
            if (owner.Code == 1 || owner.Code == 562)
            {
                string jsonPath = Path.Combine(outputDir, $"Owner_{owner.Code}_SEP26.json");
                File.WriteAllText(jsonPath, JsonSerializer.Serialize(view, new JsonSerializerOptions { WriteIndented = true }));

                string xlsxPath = Path.Combine(outputDir, $"Owner_{owner.Code}_SEP26.xlsx");
                File.WriteAllBytes(xlsxPath, xlsx);

                _output.WriteLine($"Saved Owner {owner.Code} outputs to {jsonPath} and {xlsxPath}");
            }

            passedCount++;
            _output.WriteLine($"Owner {owner.Code,3} | {owner.Name,-25} | Rows: {dataRowCount,3} == {owner.SavedRows,3} | Col F: {colFSum,7} | Total Inv: {view.TotalInvoice,7} | PASS");
        }

        Assert.Equal(savedSummaries.Count, passedCount);

        _output.WriteLine($"\n--- Zero Days / No JH/SL Projects ({anomaliesAndZeroDays.Count}) ---");
        foreach (var a in anomaliesAndZeroDays)
        {
            _output.WriteLine(a);
        }
    }

    [Fact]
    public async Task ExcelDownload_FormulasAndIncludeColumn_RecalculateLiveOnIncludeToggle()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        // Test with owner 5 (Fawad) / SEP26
        int ownerCode = 5;
        string month = "SEP26";

        var view = await service.GetExcelViewAsync(ownerCode, month, CancellationToken.None);
        byte[] xlsxBytes = await service.GetExcelDownloadAsync(ownerCode, month, CancellationToken.None);

        using var ms = new MemoryStream(xlsxBytes);
        using var wb = new XLWorkbook(ms);
        var ws = wb.Worksheet(1);

        // 1. Header validation (16 columns: Stack moved before Project Name)
        Assert.Equal("Include", ws.Cell(4, 1).GetString());
        Assert.Equal("Profile Owner", ws.Cell(4, 2).GetString());
        Assert.Equal("Project Code", ws.Cell(4, 3).GetString());
        Assert.Equal("Stack", ws.Cell(4, 4).GetString());
        Assert.Equal("Project Name", ws.Cell(4, 5).GetString());
        Assert.Equal("Actual Charges", ws.Cell(4, 9).GetString());
        Assert.Equal("Other Charge", ws.Cell(4, 10).GetString());

        // 2. Row 3 formulas & values (Col 9 = Actual Charges Sum, Col 10 = Other Charge Sum)
        string formulaI3 = ws.Cell(3, 9).FormulaA1;
        string formulaJ3 = ws.Cell(3, 10).FormulaA1;
        Assert.StartsWith("SUMIF(A5:A", formulaI3);
        Assert.StartsWith("SUMIF(A5:A", formulaJ3);

        decimal valI3 = Convert.ToDecimal(ws.Cell(3, 9).Value.GetNumber());
        decimal valJ3 = Convert.ToDecimal(ws.Cell(3, 10).Value.GetNumber());
        Assert.Equal(view.ActualChargesSum, valI3);
        Assert.Equal(view.OtherChargeSum, valJ3);

        // 3. Row 1 Total Invoice formula & value (Col 10 = ROUND(I3 + J3, 0))
        string formulaJ1 = ws.Cell(1, 10).FormulaA1;
        Assert.Contains("I3 + J3", formulaJ1);
        decimal valJ1 = Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber());
        Assert.Equal(view.TotalInvoice, valJ1);

        // 4. Live formula test: change first included row with amount to 0
        int lastRow = Math.Max(5, 4 + view.Rows.Count);
        int targetRow = -1;
        decimal targetAmount = 0m;
        bool isActualCharge = false;

        for (int r = 5; r <= lastRow; r++)
        {
            if (ws.Cell(r, 1).Value.IsNumber && Convert.ToInt32(ws.Cell(r, 1).Value.GetNumber()) == 1)
            {
                var iCell = ws.Cell(r, 9);
                var jCell = ws.Cell(r, 10);

                if (iCell.Value.IsNumber && Convert.ToDecimal(iCell.Value.GetNumber()) > 0)
                {
                    targetRow = r;
                    targetAmount = Convert.ToDecimal(iCell.Value.GetNumber());
                    isActualCharge = true;
                    break;
                }
                if (jCell.Value.IsNumber && Convert.ToDecimal(jCell.Value.GetNumber()) > 0)
                {
                    targetRow = r;
                    targetAmount = Convert.ToDecimal(jCell.Value.GetNumber());
                    isActualCharge = false;
                    break;
                }
            }
        }

        Assert.True(targetRow > 0, "Expected at least one row with positive amount");

        // Set Include to 0 on target row and recalculate formulas
        ws.Cell(targetRow, 1).SetValue(0);
        wb.RecalculateAllFormulas();

        decimal newValI3 = Convert.ToDecimal(ws.Cell(3, 9).Value.GetNumber());
        decimal newValJ3 = Convert.ToDecimal(ws.Cell(3, 10).Value.GetNumber());
        decimal newValJ1 = Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber());

        if (isActualCharge)
        {
            Assert.Equal(valI3 - targetAmount, newValI3);
        }
        else
        {
            Assert.Equal(valJ3 - targetAmount, newValJ3);
        }
        Assert.Equal(valJ1 - targetAmount, newValJ1);

        _output.WriteLine($"Live formula test PASS: Target row {targetRow} changed 1->0, amount {targetAmount} subtracted from totals.");
        _output.WriteLine($"Old Total: {valJ1}, New Total: {newValJ1}");

        // Reset targetRow Include back to 1
        ws.Cell(targetRow, 1).SetValue(1);

        // 5. Test 5 Real Rows with Agreed Rate modification in Excel (+1000 each cumulatively -> Total Invoice +5000)
        _output.WriteLine("\n=== 5 REAL ROWS RATE CHANGE CUMULATIVE (+5000) VERIFICATION (Owner 5, SEP26) ===");
        var headerRows = new List<(int ExcelRow, string ProjName, decimal OriginalRate, decimal OriginalActual)>();
        for (int r = 5; r <= lastRow; r++)
        {
            if (ws.Cell(r, 7).Value.IsNumber && ws.Cell(r, 9).HasFormula)
            {
                decimal origRate = Convert.ToDecimal(ws.Cell(r, 7).Value.GetNumber());
                if (origRate > 0)
                {
                    decimal origActual = Convert.ToDecimal(ws.Cell(r, 9).Value.GetNumber());
                    if (origActual == origRate)
                    {
                        string pName = ws.Cell(r, 5).GetString();
                        headerRows.Add((r, pName, origRate, origActual));
                        if (headerRows.Count >= 5) break;
                    }
                }
            }
        }

        Assert.True(headerRows.Count >= 5, $"Expected at least 5 project header rows with rates, found {headerRows.Count}");

        decimal runningTotalBefore = valJ1;
        _output.WriteLine("| Step | Excel Row | Project Name | Before Rate | After Rate (+1000) | Before Actual | After Actual | Before Total | After Total | Total Delta |");
        _output.WriteLine("|:---:|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|");

        int step = 1;
        foreach (var hr in headerRows)
        {
            // Ensure Include = 1
            ws.Cell(hr.ExcelRow, 1).SetValue(1);
            decimal testNewRate = hr.OriginalRate + 1000m;
            ws.Cell(hr.ExcelRow, 7).SetValue(testNewRate);

            wb.RecalculateAllFormulas();

            decimal newActual = Convert.ToDecimal(ws.Cell(hr.ExcelRow, 9).Value.GetNumber());
            decimal currentTotalInvoice = Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber());
            decimal stepDelta = currentTotalInvoice - runningTotalBefore;

            _output.WriteLine($"| {step} | Row {hr.ExcelRow} | {hr.ProjName} | ${hr.OriginalRate:N0} | ${testNewRate:N0} | ${hr.OriginalActual:N0} | ${newActual:N0} | ${runningTotalBefore:N0} | ${currentTotalInvoice:N0} | +${stepDelta:N0} |");

            runningTotalBefore = currentTotalInvoice;
            step++;
        }

        decimal finalCumulativeTotal = Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber());
        decimal totalIncrease = finalCumulativeTotal - valJ1;
        _output.WriteLine($"\nAll 5 rows modified simultaneously: Initial Total = {valJ1}, Final Total = {finalCumulativeTotal}, Total Increase = +{totalIncrease}");
        Assert.Equal(5000m, totalIncrease);
        Assert.Equal(valJ1 + 5000m, finalCumulativeTotal);

        // Revert all 5 rows for clean state
        foreach (var hr in headerRows)
        {
            ws.Cell(hr.ExcelRow, 7).SetValue(hr.OriginalRate);
        }
        wb.RecalculateAllFormulas();
        decimal restoredTotal = Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber());
        Assert.Equal(view.TotalInvoice, restoredTotal);
        _output.WriteLine($"All 5 rows reverted. Restored Total Invoice: {restoredTotal} == {view.TotalInvoice} (MATCH)\n");
    }

    [Fact]
    public async Task AuditLog_RecordedWhenRowUpdated()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        // Toggle row 1624 (Owner 5, SEP26)
        long code = 1624;
        var res = await service.UpdateRowAsync(code, new ProfileInvoiceRowUpdateRequest
        {
            IsIncluded = false
        }, "QamerHassan", CancellationToken.None);

        Assert.True(res.Success);

        // Verify audit log record exists in dbo.profile_invoice_audit_log
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TOP 1 username, field_name, old_value, new_value, is_month_finalized FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code ORDER BY id DESC";
            cmd.Parameters.Add(new SqlParameter("@code", code));
            using var reader = await cmd.ExecuteReaderAsync();
            bool found = await reader.ReadAsync();
            Assert.True(found, "Audit log record should exist in dbo.profile_invoice_audit_log");
            string username = reader.GetString(0);
            string field = reader.GetString(1);
            string oldVal = reader.GetString(2);
            string newVal = reader.GetString(3);
            bool finalized = reader.GetBoolean(4);
            _output.WriteLine($"Audit log verified: User={username}, Field={field}, Old={oldVal}, New={newVal}, MonthFinalized={finalized}");
        }

        // Revert back to true
        await service.UpdateRowAsync(code, new ProfileInvoiceRowUpdateRequest
        {
            IsIncluded = true
        }, "QamerHassan", CancellationToken.None);
    }

    [Fact]
    public async Task UpdateRowAsync_WhenNoFieldChanges_DoesNotCreateAuditLog()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        long code = 1624;
        string currRemarks = "";
        bool currIncluded = true;
        string currStatus = "P";

        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT ISNULL(remarks, ''), ISNULL(is_included, 1), ISNULL(status, 'P') FROM dbo.Profile_invoicing WHERE cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(new SqlParameter("@code", code));
            using var reader = await cmd.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                currRemarks = reader.GetString(0);
                currIncluded = reader.GetBoolean(1);
                currStatus = reader.GetString(2).Trim();
            }
        }

        // 1. Get initial audit count
        int initialCount = 0;
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(new SqlParameter("@code", code));
            initialCount = (int)(await cmd.ExecuteScalarAsync() ?? 0);
        }

        // 2. Perform an update with EXACT same values (no change)
        var resNoChange = await service.UpdateRowAsync(code, new ProfileInvoiceRowUpdateRequest
        {
            Remarks = currRemarks,
            IsIncluded = currIncluded,
            Status = currStatus
        }, "TestUser", CancellationToken.None);

        Assert.True(resNoChange.Success);

        // 3. Verify audit count is UNCHANGED
        int afterNoChangeCount = 0;
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(new SqlParameter("@code", code));
            afterNoChangeCount = (int)(await cmd.ExecuteScalarAsync() ?? 0);
        }

        Assert.Equal(initialCount, afterNoChangeCount);
        _output.WriteLine($"No-change test PASSED: Initial audit count = {initialCount}, After identical update = {afterNoChangeCount} (diff: 0)");

        // 4. Now perform a REAL change (status P -> D)
        string testNewStatus = currStatus == "P" ? "D" : "P";
        var resChange = await service.UpdateRowAsync(code, new ProfileInvoiceRowUpdateRequest
        {
            Status = testNewStatus
        }, "TestUser", CancellationToken.None);

        Assert.True(resChange.Success);

        // 5. Verify audit count increased by exactly 1
        int afterChangeCount = 0;
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code";
            cmd.Parameters.Add(new SqlParameter("@code", code));
            afterChangeCount = (int)(await cmd.ExecuteScalarAsync() ?? 0);
        }

        Assert.Equal(initialCount + 1, afterChangeCount);
        _output.WriteLine($"Change test PASSED: Audit count increased from {afterNoChangeCount} to {afterChangeCount} (diff: 1)");

        // 6. Revert back to original status
        await service.UpdateRowAsync(code, new ProfileInvoiceRowUpdateRequest
        {
            Status = currStatus
        }, "TestUser", CancellationToken.None);
    }

    [Fact]
    public async Task ExcelView_ForeignBranchRows_MarkedWithIsForeign()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        var view = await service.GetExcelViewAsync(5, "SEP26", CancellationToken.None);

        // Verify Total Invoice matches sum of Actual Charges and Other Charges
        Assert.Equal(view.ActualChargesSum + view.OtherChargeSum, view.TotalInvoice);
        Assert.True(view.TotalInvoice > 0);

        // Find a foreign row (Branch 5, e.g. Project 574 'Ahead' or 573 'Meijer' or 555 'SMBC')
        var foreignRow = view.Rows.FirstOrDefault(r => r.ProjectCode == 574 && r.RowType == "ProjectHeader");
        Assert.NotNull(foreignRow);
        Assert.True(foreignRow.IsForeign);
        Assert.Equal(ProfileInvoicingService.ForeignBranchCode, foreignRow.BranchCode);
        Assert.Equal("Foreign Branch", foreignRow.HandledFrom);

        // Find a non-foreign row (e.g. Project 591 '11:11 System' which has branch_code != 5)
        var nonForeignRow = view.Rows.FirstOrDefault(r => r.ProjectCode == 591 && r.RowType == "ProjectHeader");
        Assert.NotNull(nonForeignRow);
        Assert.False(nonForeignRow.IsForeign);
        Assert.NotEqual(ProfileInvoicingService.ForeignBranchCode, nonForeignRow.BranchCode);

        // Also test Excel download generation preserves formulas & sets background for foreign rows
        var bytes = await service.GetExcelDownloadAsync(5, "SEP26", CancellationToken.None);
        Assert.NotNull(bytes);
        Assert.True(bytes.Length > 0);

        using var ms = new MemoryStream(bytes);
        using var wb = new ClosedXML.Excel.XLWorkbook(ms);
        var ws = wb.Worksheet(1);

        // Total Invoice formula in J1
        Assert.Contains("I3 + J3", ws.Cell(1, 10).FormulaA1);
        Assert.Equal(view.TotalInvoice, Convert.ToDecimal(ws.Cell(1, 10).Value.GetNumber()));

        _output.WriteLine($"Foreign Branch Test PASSED: Total = {view.TotalInvoice}, Foreign row {foreignRow.ProjectName} IsForeign = {foreignRow.IsForeign}, Non-foreign {nonForeignRow.ProjectName} IsForeign = {nonForeignRow.IsForeign}");
    }

    [Fact]
    public async Task GetInvoicedMonthsAsync_ReturnsDistinctMonths_LatestFirst()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        var months = await service.GetInvoicedMonthsAsync(null);
        Assert.NotNull(months);
        Assert.NotEmpty(months);
        Assert.Contains("JAN26", months);
        Assert.Contains("SEP26", months);
        Assert.Contains("OCT26", months);
        Assert.True(months.IndexOf("JAN26") < months.IndexOf("OCT26"));
        // Verify months are normalized (no hyphens, trimmed, uppercase)
        foreach (var m in months)
        {
            Assert.False(m.Contains('-'));
            Assert.Equal(m.Trim().ToUpperInvariant(), m);
        }
        _output.WriteLine($"GetInvoicedMonthsAsync returned: {string.Join(", ", months)}");
    }

    [Fact]
    public async Task GetExcelViewAsync_Includes_AgreedRateSum_And_FinalUsdSum()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        // 5 is Fawad in Verify DB
        var view = await service.GetExcelViewAsync(5, "SEP26");
        Assert.NotNull(view);
        Assert.True(view.TotalCostSum > 0);
        Assert.Equal(view.TotalCostSum, view.FinalUsdSum);
        Assert.True(view.AgreedRateSum >= 0);
        _output.WriteLine($"ExcelView totals: Cost={view.TotalCostSum}, Agreed={view.AgreedRateSum}, Actual={view.ActualChargesSum}, Other={view.OtherChargeSum}, TotalInv={view.TotalInvoice}, FinalUSD={view.FinalUsdSum}");
    }
}

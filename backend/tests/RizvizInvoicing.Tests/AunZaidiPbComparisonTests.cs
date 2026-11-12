using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;
using Xunit.Abstractions;

namespace RizvizInvoicing.Tests;

/// <summary>
/// Verifies Aun Zaidi (Group Owner 46, OCT-26) calculations and totals
/// against the official PowerBuilder CSV export (Silmun_Invoice_26-OCT.csv).
///
/// PB Top Line Ground Truth:
/// - Total Invoice: $14,081
/// - Total Cost:    $7,505
/// - Actual:        $12,464
/// - Other:         $1,617
/// </summary>
public class AunZaidiPbComparisonTests : IDisposable
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System_Verify;" +
        "User Id=InvoicingAppUser;Password=Inv@pp2026!Secure;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private readonly ITestOutputHelper _output;
    private readonly InvoicingDbContext _db;
    private readonly ProfileInvoicingService _service;

    public AunZaidiPbComparisonTests(ITestOutputHelper output)
    {
        _output = output;
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        _db = new InvoicingDbContext(options);
        _service = new ProfileInvoicingService(_db);
    }

    public void Dispose()
    {
        // Clean up any test rows inserted for Aun Zaidi OCT26 in Invoicing_System_Verify
        try
        {
            using var conn = new SqlConnection(ConnStr);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM dbo.Profile_invoicing WHERE prfgrp_own_code = 46 AND REPLACE(RTRIM(invoice_month), '-', '') = 'OCT26'";
            cmd.ExecuteNonQuery();
        }
        catch { }
        _db.Dispose();
    }

    [Fact]
    public async Task AunZaidi_OCT26_Totals_Match_PowerBuilder_CSV_GroundTruth()
    {
        // 1. Calculate & Generate Excel View
        var view = await _service.GetExcelViewAsync(46, "OCT26");

        _output.WriteLine($"[Aun Zaidi OCT26 View Results]");
        _output.WriteLine($"Total Invoice: {view.TotalInvoice} (Expected: 14081)");
        _output.WriteLine($"Total Cost:    {view.TotalCostSum} (Expected: 7505)");
        _output.WriteLine($"Sum Actual:    {view.ActualChargesSum} (Expected: 12464)");
        _output.WriteLine($"Sum Other:     {view.OtherChargeSum} (Expected: 1617)");
        _output.WriteLine($"Rows Count:    {view.Rows.Count}");

        // 2. Assert Top Lines match PB CSV Ground Truth exactly
        view.TotalInvoice.Should().Be(14081m, "Total Invoice must match PB CSV: $14,081");
        view.TotalCostSum.Should().Be(7505m, "Total Cost must match PB CSV: $7,505");
        view.ActualChargesSum.Should().Be(12464m, "Sum Actual must match PB CSV: $12,464");
        view.OtherChargeSum.Should().Be(1617m, "Sum Other must match PB CSV: $1,617");

        // 3. Verify Project Headers & Breakdown
        var projHeaders = view.Rows.Where(r => r.RowType == "ProjectHeader").ToList();
        
        // Future Tech (Project 283)
        var p283 = projHeaders.FirstOrDefault(p => p.ProjectCode == 283);
        p283.Should().NotBeNull();
        p283!.ActualCharges.Should().Be(3500m);

        // PTY Tech (Project 418, Executive)
        var p418 = projHeaders.FirstOrDefault(p => p.ProjectCode == 418);
        p418.Should().NotBeNull();
        p418!.ActualCharges.Should().Be(6164m);
        p418.IsExecutive.Should().BeTrue();

        // Vertex Pharmaceutical (Project 510, Executive)
        var p510 = projHeaders.FirstOrDefault(p => p.ProjectCode == 510);
        p510.Should().NotBeNull();
        p510!.ActualCharges.Should().Be(2800m);
        p510.IsExecutive.Should().BeTrue();

        // CTG (Project 607, Executive)
        var p607 = projHeaders.FirstOrDefault(p => p.ProjectCode == 607);
        p607.Should().NotBeNull();
        p607!.ActualCharges.Should().BeNull(); // Rate is 0
        p607.IsExecutive.Should().BeTrue();

        // Optima GOV (Project 562, Executive)
        var p562 = projHeaders.FirstOrDefault(p => p.ProjectCode == 562);
        p562.Should().NotBeNull();
        p562!.ActualCharges.Should().BeNull(); // Rate is 0
        p562.IsExecutive.Should().BeTrue();

        // 4. Verify all Detail and Standalone rows have IsIncluded == true
        var billableRows = view.Rows.Where(r => r.RowType == "Detail" || r.RowType == "Standalone");
        billableRows.All(r => r.IsIncluded == true).Should().BeTrue("All billable rows must be default included matching PB");
    }

    [Fact]
    public async Task Generate_AllGroupOwners_Table_OCT26_VerifyDB()
    {
        var groupOwners = new List<(int Code, string Name)>();
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT DISTINCT po.PrfOwn_code, po.profile_name
                FROM prof.Profile_Owners po
                WHERE po.PrfOwn_code IN (
                    SELECT DISTINCT ci.prfown_code FROM dbo.company_invoicing ci WHERE REPLACE(RTRIM(ci.invoice_month),'-','')='OCT26'
                    UNION
                    SELECT DISTINCT po2.ParentProfile_code FROM prof.Profile_Owners po2 WHERE po2.PrfOwn_code IN (
                        SELECT DISTINCT ci.prfown_code FROM dbo.company_invoicing ci WHERE REPLACE(RTRIM(ci.invoice_month),'-','')='OCT26'
                    ) AND po2.ParentProfile_code IS NOT NULL
                )
                AND po.is_profgrp_owner = 'Y'
                ORDER BY po.profile_name";
            using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                groupOwners.Add((rdr.GetInt32(0), rdr.GetString(1).Trim()));
            }
        }

        _output.WriteLine($"| Group Owner (Code) | Total Invoice ($) | Total Cost ($) | Actual ($) | Other ($) | Rows |");
        _output.WriteLine($"|:-------------------|------------------:|---------------:|-----------:|----------:|-----:|");

        decimal grandTotalInvoice = 0;
        decimal grandTotalCost = 0;
        decimal grandActual = 0;
        decimal grandOther = 0;
        int grandRows = 0;

        foreach (var (code, name) in groupOwners)
        {
            try
            {
                var view = await _service.GetExcelViewAsync(code, "OCT26");
                if (view.TotalSavedRows > 0 || view.TotalInvoice > 0)
                {
                    _output.WriteLine($"| {name} (#{code}) | {view.TotalInvoice:N0} | {view.TotalCostSum:N0} | {view.ActualChargesSum:N0} | {view.OtherChargeSum:N0} | {view.TotalSavedRows} |");
                    grandTotalInvoice += view.TotalInvoice;
                    grandTotalCost += view.TotalCostSum;
                    grandActual += view.ActualChargesSum;
                    grandOther += view.OtherChargeSum;
                    grandRows += view.TotalSavedRows;
                }
            }
            catch (Exception ex)
            {
                _output.WriteLine($"| {name} (#{code}) | ERROR: {ex.Message} | | | | |");
            }
        }

        _output.WriteLine($"| **GRAND TOTAL** | **{grandTotalInvoice:N0}** | **{grandTotalCost:N0}** | **{grandActual:N0}** | **{grandOther:N0}** | **{grandRows}** |");
    }
}

using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;
using Xunit.Abstractions;

namespace RizvizInvoicing.Tests;

public class ProfileInvoice42RegressionTests
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private readonly ITestOutputHelper _output;

    public ProfileInvoice42RegressionTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public async Task RegressionTest_All42SavedOwners_MatchCalculateDryRunAsync()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        using var db = new InvoicingDbContext(options);
        var service = new ProfileInvoicingService(db);

        // 1. Get saved group owners in SEP26 from Invoicing_System
        var savedSummaries = new List<(int Code, string Name, int SavedRows, decimal SavedTotalUsd)>();
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT 
                    pi.prfgrp_own_code,
                    p.profile_name,
                    COUNT(*) AS saved_rows,
                    SUM(ISNULL(pi.total_usd_cost, 0)) AS saved_total_usd
                FROM dbo.Profile_invoicing pi
                JOIN prof.Profile_Owners p ON pi.prfgrp_own_code = p.PrfOwn_code
                WHERE pi.invoice_month LIKE 'SEP26%'
                GROUP BY pi.prfgrp_own_code, p.profile_name
                ORDER BY p.profile_name";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                savedSummaries.Add((
                    reader.GetInt32(0),
                    reader.GetString(1).Trim(),
                    reader.GetInt32(2),
                    Convert.ToDecimal(reader.GetValue(3))
                ));
            }
        }

        Assert.True(savedSummaries.Count >= 1, $"Expected at least 1 saved owner for SEP26, found {savedSummaries.Count}");

        _output.WriteLine("==========================================================================================================");
        _output.WriteLine("ACTUAL .NET SERVICE REGRESSION TEST: 42 SAVED OWNERS (SEP26) via CalculateDryRunAsync");
        _output.WriteLine("Rule: Skip filter ONLY on 4.a (PB lines 16473-16483); TotalUsdSum = Sum(TotalUsdCost)");
        _output.WriteLine("==========================================================================================================");
        _output.WriteLine(string.Format("{0,-6} {1,-28} {2,10} {3,10} {4,10} {5,12} {6,12} {7,10} {8,12}",
            "Code", "Name", "SavedRows", "GenRows", "RowsMatch", "SavedUsd", "GenUsd", "CostMatch", "OverallMatch"));
        _output.WriteLine("----------------------------------------------------------------------------------------------------------");

        int matchCount = 0;
        int mismatchCount = 0;

        foreach (var s in savedSummaries)
        {
            // Call actual .NET service with bypassDuplicateGuard: true
            var dryRun = await service.CalculateDryRunAsync(s.Code, "SEP26", bypassDuplicateGuard: true);

            int genRows = dryRun.Rows.Count;
            decimal genUsd = dryRun.TotalUsdSum;

            bool rowsMatch = (s.SavedRows == genRows);
            bool costMatch = (s.SavedTotalUsd == genUsd);
            bool overallMatch = rowsMatch && costMatch;

            if (overallMatch) matchCount++; else mismatchCount++;

            _output.WriteLine(string.Format("{0,-6} {1,-28} {2,10} {3,10} {4,10} {5,12:F0} {6,12:F0} {7,10} {8,12}",
                s.Code, s.Name, s.SavedRows, genRows, rowsMatch, s.SavedTotalUsd, genUsd, costMatch, overallMatch));

            Assert.True(rowsMatch, $"Row count mismatch for owner {s.Code} ({s.Name}): saved {s.SavedRows} vs gen {genRows}");
            Assert.True(costMatch, $"Total cost mismatch for owner {s.Code} ({s.Name}): saved {s.SavedTotalUsd} vs gen {genUsd}");
        }

        _output.WriteLine("==========================================================================================================");
        _output.WriteLine($"Total Owners Tested : {savedSummaries.Count}");
        _output.WriteLine($"Exact Matches       : {matchCount} / {savedSummaries.Count}");
        _output.WriteLine($"Mismatches          : {mismatchCount} / {savedSummaries.Count}");
        _output.WriteLine("==========================================================================================================");

        Assert.Equal(savedSummaries.Count, matchCount);
        Assert.Equal(0, mismatchCount);
    }
}

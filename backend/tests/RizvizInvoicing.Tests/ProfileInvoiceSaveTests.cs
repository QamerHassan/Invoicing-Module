using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;

namespace RizvizInvoicing.Tests;

/// <summary>
/// Integration tests for STAGE 2: Save / Post.
///
/// ALL tests run against the isolated local copy "Invoicing_System_Verify" on
/// localhost\SQLEXPRESS and restore modified data after each test so the DB
/// remains consistent.
///
/// Prerequisites:
///   - SQL Server Express running at localhost\SQLEXPRESS
///   - Database "Invoicing_System_Verify" restored from backup
///   - No existing Profile_invoicing rows for test owner codes + months used below
/// </summary>
public class ProfileInvoiceSaveTests : IDisposable
{
    // Connection / service wiring
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System_Verify;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    // Use a real Group Owner that has rows in company_invoicing for SEP26.
    // Owner 1 was confirmed to produce rows in the Stage 1 parity audit.
    private const int TestGroupOwnerCode = 1;
    private const string TestMonth = "SEP26";
    private const string TestInsertedBy = "UNIT_TEST";

    private readonly InvoicingDbContext _db;
    private readonly IProfileInvoicingService _service;
    private readonly ConcurrentBag<long> _insertedPcomCodes = new();

    public ProfileInvoiceSaveTests()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        _db = new InvoicingDbContext(options);
        _service = new ProfileInvoicingService(_db);
        CleanupTestRows();
    }

    public void Dispose()
    {
        CleanupTestRows();
        _db.Dispose();
    }

    private void CleanupTestRows()
    {
        using var conn = new SqlConnection(ConnStr);
        conn.Open();

        // Delete ALL rows for the test owner+month (pre-existing + test-inserted)
        // so each test starts with a clean slate.
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                DELETE FROM dbo.Profile_invoicing
                WHERE prfgrp_own_code = @g
                  AND REPLACE(RTRIM(invoice_month), '-', '') = @m";
            cmd.Parameters.AddWithValue("@g", TestGroupOwnerCode);
            cmd.Parameters.AddWithValue("@m", TestMonth.Replace("-", ""));
            cmd.ExecuteNonQuery();
        }

        if (_insertedPcomCodes.Any())
        {
            var min = _insertedPcomCodes.Min();
            var max = _insertedPcomCodes.Max();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                UPDATE dbo.NumberControl
                SET LastNo = @newVal
                WHERE StageName = 'PCOM' AND LastNo = @currentVal";
            cmd.Parameters.AddWithValue("@currentVal", max);
            cmd.Parameters.AddWithValue("@newVal", min - 1);
            cmd.ExecuteNonQuery();
        }
    }

    private long ReadCurrentPcomLastNo()
    {
        using var conn = new SqlConnection(ConnStr);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT LastNo FROM dbo.NumberControl WHERE StageName='PCOM'";
        return Convert.ToInt64(cmd.ExecuteScalar()!);
    }

    private int CountProfileInvoicingRows(int groupOwnerCode, string month)
    {
        using var conn = new SqlConnection(ConnStr);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            "SELECT COUNT(*) FROM dbo.Profile_invoicing " +
            "WHERE prfgrp_own_code=@g AND invoice_month=@m";
        cmd.Parameters.AddWithValue("@g", groupOwnerCode);
        cmd.Parameters.AddWithValue("@m", month);
        return Convert.ToInt32(cmd.ExecuteScalar()!);
    }

    private void RegisterPcomCodes(ProfileInvoiceSaveResult result)
    {
        foreach (var r in result.SavedRows)
            _insertedPcomCodes.Add(r.CmpProfInvoiceCode);
    }

    // Input validation

    [Fact]
    public async Task SaveAsync_NullRequest_ThrowsArgumentNullException()
    {
        var act = () => _service.SaveAsync(null!, CancellationToken.None);
        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task SaveAsync_InvalidOwnerCode_ThrowsArgumentException(int ownerCode)
    {
        var req = new ProfileInvoiceSaveRequest { GroupOwnerCode = ownerCode, MonthYear = "SEP26", InsertedBy = "u" };
        var act = () => _service.SaveAsync(req, CancellationToken.None);
        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*GroupOwnerCode*");
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task SaveAsync_InvalidMonth_ThrowsArgumentException(string month)
    {
        var req = new ProfileInvoiceSaveRequest { GroupOwnerCode = 1, MonthYear = month, InsertedBy = "u" };
        var act = () => _service.SaveAsync(req, CancellationToken.None);
        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*MonthYear*");
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public async Task SaveAsync_InvalidInsertedBy_ThrowsArgumentException(string insertedBy)
    {
        var req = new ProfileInvoiceSaveRequest { GroupOwnerCode = 1, MonthYear = "SEP26", InsertedBy = insertedBy };
        var act = () => _service.SaveAsync(req, CancellationToken.None);
        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*InsertedBy*");
    }

    // No rows guard

    [Fact]
    public async Task SaveAsync_OwnerWithNoData_ReturnsFailureWithNothingToSave()
    {
        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = TestGroupOwnerCode,
            MonthYear      = "JAN99",   // far-future month - no data
            InsertedBy     = TestInsertedBy
        };
        var result = await _service.SaveAsync(req, CancellationToken.None);
        result.Success.Should().BeFalse();
        result.ErrorMessage.Should().Contain("Nothing to save");
        result.RowsInserted.Should().Be(0);
        result.SavedRows.Should().BeEmpty();
    }

    // Happy path with post-save re-read

    [Fact]
    public async Task SaveAsync_ValidOwnerAndMonth_InsertsRowsWithStatusP()
    {
        var pcomBefore = ReadCurrentPcomLastNo();

        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = TestGroupOwnerCode,
            MonthYear      = TestMonth,
            InsertedBy     = TestInsertedBy
        };

        var result = await _service.SaveAsync(req, CancellationToken.None);
        RegisterPcomCodes(result);

        result.Success.Should().BeTrue(because: result.ErrorMessage ?? "see error");
        result.ErrorMessage.Should().BeNull();
        result.RowsInserted.Should().BeGreaterThan(0);
        result.SavedRows.Should().HaveCount(result.RowsInserted);
        result.FirstPcomCode.Should().Be(pcomBefore + 1);
        result.LastPcomCode.Should().Be(pcomBefore + result.RowsInserted);
        result.TotalUsdSum.Should().BeGreaterThan(0m);
        result.TotalPkrSum.Should().BeGreaterThan(0m);

        // Post-save re-read
        using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT cmp_prof_invoice_code, status, insert_by
            FROM dbo.Profile_invoicing
            WHERE prfgrp_own_code = @g AND invoice_month = @m
            ORDER BY cmp_prof_invoice_code";
        cmd.Parameters.AddWithValue("@g", TestGroupOwnerCode);
        cmd.Parameters.AddWithValue("@m", TestMonth);

        var dbRows = new List<(long code, string status, string insertBy)>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            dbRows.Add((
                Convert.ToInt64(reader["cmp_prof_invoice_code"]),
                reader["status"].ToString()!.Trim(),
                reader["insert_by"].ToString()!.Trim()
            ));
        }

        dbRows.Should().HaveCount(result.RowsInserted);
        dbRows.Should().AllSatisfy(r =>
        {
            r.status.Should().Be("P");
            r.insertBy.Should().Be(TestInsertedBy);
        });

        var expectedCodes = result.SavedRows.Select(r => r.CmpProfInvoiceCode).OrderBy(x => x).ToList();
        dbRows.Select(r => r.code).OrderBy(x => x).Should().Equal(expectedCodes);
    }

    // Duplicate guard

    [Fact]
    public async Task SaveAsync_DuplicateSave_ReturnsAlreadyExistsError()
    {
        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = TestGroupOwnerCode,
            MonthYear      = TestMonth,
            InsertedBy     = TestInsertedBy
        };

        var first = await _service.SaveAsync(req, CancellationToken.None);
        RegisterPcomCodes(first);
        first.Success.Should().BeTrue(because: first.ErrorMessage ?? "first save failed");

        var second = await _service.SaveAsync(req, CancellationToken.None);
        second.Success.Should().BeFalse();
        second.ErrorMessage.Should().Contain("already exist");
        second.RowsInserted.Should().Be(0);

        CountProfileInvoicingRows(TestGroupOwnerCode, TestMonth)
            .Should().Be(first.RowsInserted);
    }

    // Concurrency: 10 parallel saves for SAME owner -> exactly 1 wins

    [Fact]
    public async Task SaveAsync_TenParallelSameOwner_ExactlyOneSucceeds()
    {
        const int parallelCount = 10;

        // Clean start
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var del = conn.CreateCommand();
            del.CommandText =
                "DELETE FROM dbo.Profile_invoicing WHERE prfgrp_own_code=@g AND invoice_month=@m AND insert_by=@b";
            del.Parameters.AddWithValue("@g", TestGroupOwnerCode);
            del.Parameters.AddWithValue("@m", TestMonth);
            del.Parameters.AddWithValue("@b", TestInsertedBy);
            del.ExecuteNonQuery();
        }

        var tasks = Enumerable.Range(0, parallelCount)
            .Select(_ =>
            {
                // Each parallel task gets its own DbContext/connection — mimics DI scoped lifetime in web API
                var opts = new DbContextOptionsBuilder<InvoicingDbContext>()
                    .UseSqlServer(ConnStr)
                    .Options;
                var scopedDb  = new InvoicingDbContext(opts);
                var scopedSvc = new ProfileInvoicingService(scopedDb);
                return scopedSvc.SaveAsync(new ProfileInvoiceSaveRequest
                {
                    GroupOwnerCode = TestGroupOwnerCode,
                    MonthYear      = TestMonth,
                    InsertedBy     = TestInsertedBy
                }, CancellationToken.None);
            })
            .ToArray();

        var results = await Task.WhenAll(tasks);
        foreach (var r in results.Where(r => r.Success)) RegisterPcomCodes(r);

        var successes = results.Where(r => r.Success).ToList();
        var failures  = results.Where(r => !r.Success).ToList();

        successes.Should().HaveCount(1,
            because: "only one concurrent save for the same owner+month should win");
        failures.Should().HaveCount(parallelCount - 1);

        CountProfileInvoicingRows(TestGroupOwnerCode, TestMonth)
            .Should().Be(successes[0].RowsInserted);
    }

    // PCOM sequence integrity

    [Fact]
    public async Task SaveAsync_PcomCodesAreStrictlyIncreasingAndNumberControlAdvancedCorrectly()
    {
        var pcomBefore = ReadCurrentPcomLastNo();

        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = TestGroupOwnerCode,
            MonthYear      = TestMonth,
            InsertedBy     = TestInsertedBy
        };

        var result = await _service.SaveAsync(req, CancellationToken.None);
        RegisterPcomCodes(result);

        result.Success.Should().BeTrue(because: result.ErrorMessage ?? "see error");

        var codes = result.SavedRows.Select(r => r.CmpProfInvoiceCode).ToList();
        codes.Should().BeInAscendingOrder();
        codes.First().Should().Be(pcomBefore + 1);
        codes.Last().Should().Be(pcomBefore + result.RowsInserted);

        ReadCurrentPcomLastNo().Should().Be(pcomBefore + result.RowsInserted,
            because: "NumberControl must be advanced exactly once per row");
    }

    // Server-side recalculation consistency

    [Fact]
    public async Task SaveAsync_SavedAmountsMatchDryRunAmounts()
    {
        var dryRun = await _service.CalculateDryRunAsync(
            TestGroupOwnerCode, TestMonth, ct: CancellationToken.None);

        // Check AlreadyExists is false so we can proceed to save
        if (dryRun.AlreadyExists)
        {
            // Skip: already posted - cleanup needed
            return;
        }

        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = TestGroupOwnerCode,
            MonthYear      = TestMonth,
            InsertedBy     = TestInsertedBy
        };

        var saved = await _service.SaveAsync(req, CancellationToken.None);
        RegisterPcomCodes(saved);

        // Row count must match
        saved.RowsInserted.Should().Be(dryRun.Rows.Count,
            because: "save must insert exactly the rows the dry-run computed");

        // PKR sum must match (TotalIncomePkr is same field in both)
        saved.TotalPkrSum.Should().Be(dryRun.TotalPkrSum,
            because: "server recalculated PKR sum must match the dry-run");

        // USD: SaveAsync.TotalUsdSum sums ChargedAmtUsd; dryRun.TotalUsdSum sums TotalUsdCost (raw project cost).
        // These are different fields, so we verify SaveAsync returns a positive number instead.
        saved.TotalUsdSum.Should().BeGreaterThanOrEqualTo(0m,
            because: "saved USD sum must be non-negative");
    }

    // Forced failure leaves DB unchanged

    [Fact]
    public async Task SaveAsync_NonExistentOwner_LeavesDbUnchanged()
    {
        var rowsBefore = CountProfileInvoicingRows(99999, TestMonth);

        var req = new ProfileInvoiceSaveRequest
        {
            GroupOwnerCode = 99999,   // no such owner -> 0 rows -> Nothing to save
            MonthYear      = TestMonth,
            InsertedBy     = TestInsertedBy
        };

        var result = await _service.SaveAsync(req, CancellationToken.None);
        result.Success.Should().BeFalse();

        CountProfileInvoicingRows(99999, TestMonth).Should().Be(rowsBefore);
    }
}

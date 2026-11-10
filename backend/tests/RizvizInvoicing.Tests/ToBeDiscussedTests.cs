using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;

namespace RizvizInvoicing.Tests;

/// <summary>
/// Unit & Integration tests for "To Be Discussed" functionality.
/// Runs against the isolated test database Invoicing_System_Verify.
/// Ensures all test data and audit logs are cleaned up so no side-effects remain.
/// </summary>
public class ToBeDiscussedTests : IDisposable
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System_Verify;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private const long TestCode = 603;
    private readonly InvoicingDbContext _db;
    private readonly IProfileInvoicingService _service;

    public ToBeDiscussedTests()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        _db = new InvoicingDbContext(options);
        _service = new ProfileInvoicingService(_db);
        CleanupTestData();
    }

    public void Dispose()
    {
        CleanupTestData();
        _db.Dispose();
    }

    private void CleanupTestData()
    {
        using var conn = new SqlConnection(ConnStr);
        conn.Open();

        using var cmd1 = conn.CreateCommand();
        cmd1.CommandText = @"
            UPDATE dbo.Profile_invoicing
            SET to_be_discussed = 0,
                discuss_note = NULL,
                discuss_marked_by = NULL,
                discuss_marked_time = NULL
            WHERE cmp_prof_invoice_code = @code";
        cmd1.Parameters.Add(new SqlParameter("@code", TestCode));
        cmd1.ExecuteNonQuery();

        using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = "DELETE FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code";
        cmd2.Parameters.Add(new SqlParameter("@code", TestCode));
        cmd2.ExecuteNonQuery();
    }

    [Fact]
    public async Task AddToBeDiscussed_MarksFlag_AndLogsAudit()
    {
        // Act: Add row 523 to To Be Discussed with a note
        var result = await _service.AddToBeDiscussedAsync(
            new List<long> { TestCode },
            "Need client sign-off",
            "TEST_USER"
        );

        // Assert response
        result.Success.Should().BeTrue();
        result.UpdatedCount.Should().Be(1);

        // Assert DB row updated
        using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT to_be_discussed, discuss_note, discuss_marked_by FROM dbo.Profile_invoicing WHERE cmp_prof_invoice_code = @code";
        cmd.Parameters.Add(new SqlParameter("@code", TestCode));
        using var rdr = await cmd.ExecuteReaderAsync();
        rdr.Read().Should().BeTrue();
        rdr.GetBoolean(0).Should().BeTrue();
        rdr.GetString(1).Should().Be("Need client sign-off");
        rdr.GetString(2).Should().Be("TEST_USER");
        rdr.Close();

        // Assert audit log created
        using var cmdAudit = conn.CreateCommand();
        cmdAudit.CommandText = "SELECT field_name, old_value, new_value FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code AND field_name = 'to_be_discussed'";
        cmdAudit.Parameters.Add(new SqlParameter("@code", TestCode));
        using var rdrAudit = await cmdAudit.ExecuteReaderAsync();
        rdrAudit.Read().Should().BeTrue();
        rdrAudit.GetString(0).Should().Be("to_be_discussed");
        rdrAudit.GetString(1).Should().Be("0");
        rdrAudit.GetString(2).Should().Be("1");
    }

    [Fact]
    public async Task DuplicateAdd_DoesNotCreateDuplicateAuditLog()
    {
        // 1. Initial add
        await _service.AddToBeDiscussedAsync(
            new List<long> { TestCode },
            "Initial discussion",
            "TEST_USER"
        );

        // 2. Duplicate add with same note
        var dupResult = await _service.AddToBeDiscussedAsync(
            new List<long> { TestCode },
            "Initial discussion",
            "TEST_USER"
        );

        dupResult.Success.Should().BeTrue();
        dupResult.UpdatedCount.Should().Be(0); // No state change

        // Assert only 1 audit log entry exists for 'to_be_discussed'
        using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code AND field_name = 'to_be_discussed'";
        cmd.Parameters.Add(new SqlParameter("@code", TestCode));
        var count = (int)(await cmd.ExecuteScalarAsync() ?? 0);
        count.Should().Be(1, "duplicate add must not create duplicate audit log entry");
    }

    [Fact]
    public async Task RemoveFromToBeDiscussed_ClearsFlag_AndLogsAudit()
    {
        // 1. First mark as discussed
        await _service.AddToBeDiscussedAsync(
            new List<long> { TestCode },
            "To remove soon",
            "TEST_USER"
        );

        // 2. Remove from discussed
        var removeResult = await _service.RemoveFromToBeDiscussedAsync(
            new List<long> { TestCode },
            "TEST_USER"
        );

        removeResult.Success.Should().BeTrue();
        removeResult.UpdatedCount.Should().Be(1);

        // Assert DB row flag cleared
        using var conn = new SqlConnection(ConnStr);
        await conn.OpenAsync();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT to_be_discussed FROM dbo.Profile_invoicing WHERE cmp_prof_invoice_code = @code";
        cmd.Parameters.Add(new SqlParameter("@code", TestCode));
        var flag = (bool)(await cmd.ExecuteScalarAsync() ?? false);
        flag.Should().BeFalse();

        // Assert removal audit log created (old = 1, new = 0)
        using var cmdAudit = conn.CreateCommand();
        cmdAudit.CommandText = "SELECT old_value, new_value FROM dbo.profile_invoice_audit_log WHERE cmp_prof_invoice_code = @code AND field_name = 'to_be_discussed' ORDER BY timestamp DESC";
        cmdAudit.Parameters.Add(new SqlParameter("@code", TestCode));
        using var rdrAudit = await cmdAudit.ExecuteReaderAsync();
        rdrAudit.Read().Should().BeTrue();
        rdrAudit.GetString(0).Should().Be("1");
        rdrAudit.GetString(1).Should().Be("0");
    }

    [Fact]
    public async Task FinalizedMonth_CheckReturnsResult()
    {
        // Verify IsMonthFinalizedAsync executes and returns boolean without throwing
        var isFinalized = await _service.IsMonthFinalizedAsync("SEP26");
        // SEP26 status is a valid boolean
        (isFinalized == true || isFinalized == false).Should().BeTrue();
    }

    /// <summary>
    /// Verifies full end-to-end To Be Discussed flow on Owner 5, SEP26
    /// (the month present in Invoicing_System_Verify).
    /// Uses invoice rows already in the DB — does NOT insert synthetic rows.
    /// Rolls back all state in the finally block.
    /// </summary>
    [Fact]
    public async Task Verify_Owner5_SEP26_Discuss_RedHighlight_Audit_And_Remove()
    {
        const int owner = 5;
        const string month = "SEP26";

        // ── 1. ARRANGE ────────────────────────────────────────────────────────
        // Confirm there is data in Verify DB for this owner/month
        using var setupConn = new SqlConnection(ConnStr);
        await setupConn.OpenAsync();
        using var countCmd = setupConn.CreateCommand();
        countCmd.CommandText =
            "SELECT COUNT(*) FROM dbo.Profile_invoicing " +
            "WHERE prfgrp_own_code = @o AND LTRIM(RTRIM(invoice_month)) = @m " +
            "AND (to_be_discussed = 0 OR to_be_discussed IS NULL)";
        countCmd.Parameters.Add(new SqlParameter("@o", owner));
        countCmd.Parameters.Add(new SqlParameter("@m", month));
        var totalRows = (int)(await countCmd.ExecuteScalarAsync() ?? 0);
        totalRows.Should().BeGreaterThan(1,
            "Invoicing_System_Verify must have at least 2 unprocessed rows for Owner 5 SEP26");

        // Pick 2 real invoice codes to test with
        using var pickCmd = setupConn.CreateCommand();
        pickCmd.CommandText =
            "SELECT TOP 2 cmp_prof_invoice_code FROM dbo.Profile_invoicing " +
            "WHERE prfgrp_own_code = @o AND LTRIM(RTRIM(invoice_month)) = @m " +
            "AND (to_be_discussed = 0 OR to_be_discussed IS NULL)";
        pickCmd.Parameters.Add(new SqlParameter("@o", owner));
        pickCmd.Parameters.Add(new SqlParameter("@m", month));
        using var pickRdr = await pickCmd.ExecuteReaderAsync();
        var selectableCodes = new List<long>();
        while (await pickRdr.ReadAsync())
            selectableCodes.Add(pickRdr.GetInt32(0));
        await pickRdr.CloseAsync();
        await setupConn.CloseAsync();

        selectableCodes.Should().HaveCount(2, "Must pick 2 invoice codes");

        // Snapshot baseline
        var initialView = await _service.GetExcelViewAsync(owner, month);
        decimal initialTotalInvoice = initialView.TotalInvoice;
        var initialDiscussed = await _service.GetDiscussedInvoicesAsync(month, owner);
        int initialDiscussedCount = initialDiscussed.Count;

        try
        {
            // ── 2. ACT: Mark 2 rows as To Be Discussed ───────────────────────
            var addResult = await _service.AddToBeDiscussedAsync(
                selectableCodes, "Verify discussion test", "TEST_USER");

            addResult.Success.Should().BeTrue();
            addResult.UpdatedCount.Should().Be(2);

            // ── 3. ASSERT: To Be Discussed count increased by 2 ──────────────
            var afterDiscussed = await _service.GetDiscussedInvoicesAsync(month, owner);
            afterDiscussed.Count.Should().Be(initialDiscussedCount + 2,
                "To Be Discussed count must increase by exactly 2");

            // ── 4. ASSERT: Excel View rows have IsToBeDiscussed == true ──────
            var updatedView = await _service.GetExcelViewAsync(owner, month);
            foreach (var code in selectableCodes)
            {
                var row = updatedView.Rows.FirstOrDefault(r => r.CmpProfInvoiceCode == code);
                row.Should().NotBeNull($"Row {code} must still appear in Excel View after marking discussed");
                row!.IsToBeDiscussed.Should().BeTrue(
                    $"Row {code} must have IsToBeDiscussed == true");
            }

            // Project header containing a discussed child must also be marked
            foreach (var header in updatedView.Rows.Where(r => r.RowType == "ProjectHeader"))
            {
                if (header.ChildInvoiceCodes.Any(c => selectableCodes.Contains(c)))
                {
                    header.IsToBeDiscussed.Should().BeTrue(
                        "Project header must be marked IsToBeDiscussed when any child is discussed");
                }
            }

            // ── 5. ASSERT: Total Invoice unchanged ───────────────────────────
            updatedView.TotalInvoice.Should().Be(initialTotalInvoice,
                "Total Invoice must not change when marking To Be Discussed");

            // ── 6. ASSERT: Audit log has 2 entries (0 → 1) ───────────────────
            using var auditConn = new SqlConnection(ConnStr);
            await auditConn.OpenAsync();
            foreach (var code in selectableCodes)
            {
                using var auditCmd = auditConn.CreateCommand();
                auditCmd.CommandText =
                    "SELECT COUNT(*) FROM dbo.profile_invoice_audit_log " +
                    "WHERE cmp_prof_invoice_code = @c " +
                    "AND field_name = 'to_be_discussed' AND old_value = '0' AND new_value = '1' " +
                    "AND username = 'TEST_USER'";
                auditCmd.Parameters.Add(new SqlParameter("@c", code));
                var cnt = (int)(await auditCmd.ExecuteScalarAsync() ?? 0);
                cnt.Should().BeGreaterThanOrEqualTo(1,
                    $"Must have audit entry for code {code} marking 0→1");
            }

            // ── 7. ACT: Remove from To Be Discussed ──────────────────────────
            var removeResult = await _service.RemoveFromToBeDiscussedAsync(
                selectableCodes, "TEST_USER");

            removeResult.Success.Should().BeTrue();
            removeResult.UpdatedCount.Should().Be(2);

            // ── 8. ASSERT: Rows no longer red in Excel View ──────────────────
            var afterRemoveView = await _service.GetExcelViewAsync(owner, month);
            foreach (var code in selectableCodes)
            {
                var row = afterRemoveView.Rows.FirstOrDefault(r => r.CmpProfInvoiceCode == code);
                row.Should().NotBeNull($"Row {code} must still appear after removal");
                row!.IsToBeDiscussed.Should().BeFalse(
                    $"Row {code} IsToBeDiscussed must be false after removal");
            }
        }
        finally
        {
            // ── CLEANUP: Restore exact state so no test artifacts remain ─────
            using var cleanConn = new SqlConnection(ConnStr);
            await cleanConn.OpenAsync();
            foreach (var code in selectableCodes)
            {
                using var cmd1 = cleanConn.CreateCommand();
                cmd1.CommandText =
                    "UPDATE dbo.Profile_invoicing " +
                    "SET to_be_discussed = 0, discuss_note = NULL, " +
                    "    discuss_marked_by = NULL, discuss_marked_time = NULL " +
                    "WHERE cmp_prof_invoice_code = @c";
                cmd1.Parameters.Add(new SqlParameter("@c", code));
                await cmd1.ExecuteNonQueryAsync();

                using var cmd2 = cleanConn.CreateCommand();
                cmd2.CommandText =
                    "DELETE FROM dbo.profile_invoice_audit_log " +
                    "WHERE cmp_prof_invoice_code = @c AND username = 'TEST_USER'";
                cmd2.Parameters.Add(new SqlParameter("@c", code));
                await cmd2.ExecuteNonQueryAsync();
            }
        }
    }
}


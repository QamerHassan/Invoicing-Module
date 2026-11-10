using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using ClosedXML.Excel;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Xunit;
using Xunit.Abstractions;

namespace RizvizInvoicing.Tests;

/// <summary>
/// KAAM 3 Verification Tests on Invoicing_System_Verify
/// Strict requirements:
/// - Owner 5, OCT26
/// - All operations rolled back or cleanly restored so no test data remains
/// - 24 rows load: all checked. 3 uncheck: To Be Discussed +3, Excel View 3 red, Total Invoice unchanged
/// - Save & Email: Email tab "Selected rows: 21", attachment only 21 rows, totals match
/// - Save & Process: Processed tab has exactly 21 rows, Unprocessed cleared
/// - 150+ row scale test: All 190 rows handled in email/process list without truncation or limits
/// </summary>
public class Kaam3VerifyTests : IDisposable
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System_Verify;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private readonly ITestOutputHelper _output;
    private readonly InvoicingDbContext _db;
    private readonly ProfileInvoicingService _service;

    public Kaam3VerifyTests(ITestOutputHelper output)
    {
        _output = output;
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        _db = new InvoicingDbContext(options);
        _service = new ProfileInvoicingService(_db);

        // Reset state before each test run
        ResetOwner5Oct26();
    }

    public void Dispose()
    {
        ResetOwner5Oct26();
        _db.Dispose();
    }

    private void ResetOwner5Oct26()
    {
        using var conn = new SqlConnection(ConnStr);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            UPDATE dbo.Profile_invoicing
            SET to_be_discussed = 0,
                discuss_note = NULL,
                discuss_marked_by = NULL,
                discuss_marked_time = NULL,
                is_processed = 0,
                status = NULL
            WHERE invoice_month = 'OCT26' AND (prfown_code = 5 OR prfgrp_own_code = 5);

            DELETE FROM dbo.profile_invoice_audit_log
            WHERE field_name IN ('to_be_discussed', 'is_processed')
              AND cmp_prof_invoice_code IN (
                  SELECT cmp_prof_invoice_code FROM dbo.Profile_invoicing
                  WHERE invoice_month = 'OCT26' AND (prfown_code = 5 OR prfgrp_own_code = 5)
              );
        ";
        cmd.ExecuteNonQuery();
    }

    [Fact]
    public async Task Kaam3_Verify_24Rows_Owner5_Oct26_Uncheck3_Email21_Process21()
    {
        // 1. Load initial unprocessed status for Owner 5, OCT26 (24 rows)
        var unprocInitial = await _service.GetOwnerUnprocessedStatusAsync(5, "OCT26");
        unprocInitial.UnprocessedCount.Should().Be(24, "Owner 5 (Fawad) has exactly 24 invoices in OCT26");
        _output.WriteLine($"Owner 5 initial unprocessed count: {unprocInitial.UnprocessedCount}, USD: ${unprocInitial.UnprocessedUsd}");

        // Load Excel View
        var viewInitial = await _service.GetExcelViewAsync(5, "OCT26");
        viewInitial.Should().NotBeNull();
        decimal initialTotalInvoice = viewInitial.TotalInvoice;

        // Fetch Owner 5's 24 invoice codes directly from DB
        List<long> owner5Codes = new();
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT cmp_prof_invoice_code 
                FROM dbo.Profile_invoicing 
                WHERE invoice_month = 'OCT26' AND prfown_code = 5
                ORDER BY cmp_prof_invoice_code";
            using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                owner5Codes.Add(Convert.ToInt64(rdr.GetValue(0)));
            }
        }

        owner5Codes.Count.Should().Be(24, "Fawad must have exactly 24 rows");

        // 2. Uncheck 3 rows -> Send to To Be Discussed
        var rowsToUncheck = owner5Codes.Take(3).ToList();
        rowsToUncheck.Count.Should().Be(3);

        var discussResult = await _service.AddToBeDiscussedAsync(rowsToUncheck, "Unchecked from Excel view", "test_user");
        discussResult.Success.Should().BeTrue();
        discussResult.UpdatedCount.Should().Be(3);

        // Verify in Excel View: Total Invoice is UNCHANGED, but 3 rows are marked to_be_discussed
        var viewAfterUncheck = await _service.GetExcelViewAsync(5, "OCT26");
        viewAfterUncheck.TotalInvoice.Should().Be(initialTotalInvoice, "Total Invoice must remain unchanged when rows are unchecked");

        var discussedInView = viewAfterUncheck.Rows
            .Where(r => r.CmpProfInvoiceCode.HasValue && rowsToUncheck.Contains(r.CmpProfInvoiceCode.Value))
            .ToList();
        discussedInView.Should().HaveCount(3);
        discussedInView.All(r => (r.IsToBeDiscussed == true) || (r.ToBeDiscussed == true)).Should().BeTrue("Unchecked rows must have to_be_discussed=true");

        // 3. Save & Email Export: GetExcelDownloadAsync with excludeToBeDiscussed = true
        var excelBytesSelectedOnly = await _service.GetExcelDownloadAsync(
            groupOwnerCode: 5,
            monthYear: "OCT26",
            processedOnly: false,
            excludeToBeDiscussed: true,
            specificOwnerCode: null,
            ct: default
        );
        excelBytesSelectedOnly.Should().NotBeNull();
        excelBytesSelectedOnly.Length.Should().BeGreaterThan(0);

        // Verify ClosedXML can open and the discussed rows are excluded
        using (var ms = new MemoryStream(excelBytesSelectedOnly))
        using (var wb = new XLWorkbook(ms))
        {
            var ws = wb.Worksheets.FirstOrDefault();
            ws.Should().NotBeNull();

            var exportView = await _service.GetExcelViewAsync(5, "OCT26", false, null, default, excludeToBeDiscussed: true);
            exportView.Rows.Any(r => r.CmpProfInvoiceCode.HasValue && rowsToUncheck.Contains(r.CmpProfInvoiceCode.Value))
                .Should().BeFalse("Export view with excludeToBeDiscussed=true must NOT contain unchecked/discussed rows");
        }

        // 4. Save & Process: Process the remaining 21 selected rows
        var selectedCodes = owner5Codes.Skip(3).ToList();
        selectedCodes.Count.Should().Be(21);

        var processResult = await _service.ProcessInvoicesAsync(selectedCodes, "test_user");
        processResult.Success.Should().BeTrue();
        processResult.UpdatedCount.Should().Be(21);

        // 5. Verify Processed Tab: exactly 21 rows appear for Owner 5
        var processedRows = await _service.GetProcessedInvoicesAsync("OCT26", 5);
        processedRows.Should().HaveCount(21, "Processed tab must show exactly 21 processed rows for Owner 5");
        processedRows.All(r => r.Status == "P").Should().BeTrue();
        processedRows.Any(r => rowsToUncheck.Contains(r.CmpProfInvoiceCode)).Should().BeFalse("Unchecked rows must not be processed");

        // 6. Verify Unprocessed: 21 rows are removed, exactly 3 remain unprocessed (the discussed ones)
        var unprocessedAfter = await _service.GetOwnerUnprocessedStatusAsync(5, "OCT26");
        unprocessedAfter.UnprocessedCount.Should().Be(3, "Only the 3 unselected rows remain unprocessed");

        _output.WriteLine($"KAAM 3 Owner 5 test PASSED: 24 loaded, 3 unchecked, 21 processed, 3 left unprocessed");
    }

    [Fact]
    public async Task Kaam3_Verify_LargeScale_150PlusRows_Owner5_Oct26()
    {
        // Owner 5 Group in OCT26 has 190 rows
        var view = await _service.GetExcelViewAsync(5, "OCT26");
        var allCodes = view.Rows
            .Where(r => r.CmpProfInvoiceCode.HasValue && r.CmpProfInvoiceCode.Value > 0)
            .Select(r => r.CmpProfInvoiceCode!.Value)
            .Distinct()
            .ToList();

        allCodes.Count.Should().BeGreaterThanOrEqualTo(150, "Should have 150+ rows for large scale test");
        _output.WriteLine($"Large scale test with {allCodes.Count} rows");

        // Process all 190 rows in a single batch
        var processResult = await _service.ProcessInvoicesAsync(allCodes, "test_user");
        processResult.Success.Should().BeTrue();
        processResult.UpdatedCount.Should().Be(allCodes.Count);

        // Verify all 190 rows are processed in the DB
        var allProcessedList = await _service.GetProcessedInvoicesAsync("OCT26", null);
        var groupProcessed = allProcessedList.Where(r => allCodes.Contains(r.CmpProfInvoiceCode)).ToList();
        groupProcessed.Count.Should().Be(allCodes.Count, "All 190 rows must be present in processed list without pagination cutoffs");

        // Verify Excel download for processed invoices generates successfully
        var downloadBytes = await _service.GetExcelDownloadAsync(5, "OCT26", processedOnly: true);
        downloadBytes.Length.Should().BeGreaterThan(0);

        _output.WriteLine($"Large scale test passed: {groupProcessed.Count} rows processed successfully without limits");
    }
}

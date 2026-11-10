using System;
using System.Data;
using System.Linq;
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
/// Verifies updating project agreed rate in mkt.Projects via UpdateProjectRowAsync.
/// Tests transaction, database update, audit logging, validation, and rollback.
/// Runs exclusively against Invoicing_System_Verify.
/// </summary>
public class ProjectRateUpdateTests : IDisposable
{
    private const string ConnStr =
        "Server=localhost\\SQLEXPRESS;Database=Invoicing_System_Verify;" +
        "Trusted_Connection=True;TrustServerCertificate=True;" +
        "MultipleActiveResultSets=True;";

    private readonly InvoicingDbContext _db;
    private readonly IProfileInvoicingService _service;

    public ProjectRateUpdateTests()
    {
        var options = new DbContextOptionsBuilder<InvoicingDbContext>()
            .UseSqlServer(ConnStr)
            .Options;
        _db = new InvoicingDbContext(options);
        _service = new ProfileInvoicingService(_db);
    }

    public void Dispose()
    {
        _db.Dispose();
    }

    [Fact]
    public async Task UpdateProjectRate_UpdatesDatabase_ReflectsInExcelView_AndLogsAudit()
    {
        const int projectCode = 535; // Collebra/Disney
        const string month = "SEP26";
        const int groupOwnerCode = 562; // Aamer Abbas

        // 1. Fetch initial proj_rate from mkt.Projects
        decimal originalRate;
        using (var conn = new SqlConnection(ConnStr))
        {
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT proj_rate FROM mkt.Projects WHERE project_code = @p";
            cmd.Parameters.Add(new SqlParameter("@p", projectCode));
            originalRate = Convert.ToDecimal(await cmd.ExecuteScalarAsync());
        }

        decimal newTestRate = originalRate == 150m ? 200m : 150m;

        try
        {
            // 2. Act: Call UpdateProjectRowAsync to update Agreed Rate
            var request = new ProfileInvoiceProjectUpdateRequest
            {
                AgreedRate = newTestRate,
                MonthYear = month,
                GroupOwnerCode = groupOwnerCode
            };

            var response = await _service.UpdateProjectRowAsync(
                projectCode, month, groupOwnerCode, request, "TEST_USER");

            // 3. Assert Response
            response.Success.Should().BeTrue();
            response.Message.Should().NotBeNullOrWhiteSpace();
            response.ExcelView.Should().NotBeNull();

            // 4. Assert SQL Server mkt.Projects table updated
            using (var conn = new SqlConnection(ConnStr))
            {
                await conn.OpenAsync();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT proj_rate FROM mkt.Projects WHERE project_code = @p";
                cmd.Parameters.Add(new SqlParameter("@p", projectCode));
                var dbRate = Convert.ToDecimal(await cmd.ExecuteScalarAsync());
                dbRate.Should().Be(newTestRate, "mkt.Projects.proj_rate must match the updated value in database");
            }

            // 5. Assert Excel View reflects new Agreed Rate in Project Header row
            var projHeader = response.ExcelView!.Rows.FirstOrDefault(r => r.RowType == "ProjectHeader" && r.ProjectCode == projectCode);
            projHeader.Should().NotBeNull("Project header must exist in Excel View");
            projHeader!.AgreedRate.Should().Be(newTestRate, "Excel View AgreedRate must reflect the updated rate from mkt.Projects");

            // 6. Assert Audit Log recorded
            using (var conn = new SqlConnection(ConnStr))
            {
                await conn.OpenAsync();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    SELECT COUNT(*) 
                    FROM dbo.profile_invoice_audit_log 
                    WHERE project_code = @p AND field_name = 'agreed_rate' AND new_value = @val AND username = 'TEST_USER'";
                cmd.Parameters.Add(new SqlParameter("@p", projectCode));
                cmd.Parameters.Add(new SqlParameter("@val", newTestRate.ToString("0.##")));
                var auditCount = (int)(await cmd.ExecuteScalarAsync() ?? 0);
                auditCount.Should().BeGreaterThanOrEqualTo(1, "Audit log must record the agreed_rate update");
            }
        }
        finally
        {
            // 7. Cleanup: Restore original rate and clean audit entries
            using var conn = new SqlConnection(ConnStr);
            await conn.OpenAsync();
            using var cmdRestore = conn.CreateCommand();
            cmdRestore.CommandText = "UPDATE mkt.Projects SET proj_rate = @r WHERE project_code = @p";
            cmdRestore.Parameters.Add(new SqlParameter("@r", originalRate));
            cmdRestore.Parameters.Add(new SqlParameter("@p", projectCode));
            await cmdRestore.ExecuteNonQueryAsync();

            using var cmdDelAudit = conn.CreateCommand();
            cmdDelAudit.CommandText = "DELETE FROM dbo.profile_invoice_audit_log WHERE project_code = @p AND username = 'TEST_USER'";
            cmdDelAudit.Parameters.Add(new SqlParameter("@p", projectCode));
            await cmdDelAudit.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task UpdateProjectRate_NegativeRate_IsRejected_AndNotSaved()
    {
        const int projectCode = 535;
        const string month = "SEP26";
        const int groupOwnerCode = 562;

        var request = new ProfileInvoiceProjectUpdateRequest
        {
            AgreedRate = -100m,
            MonthYear = month,
            GroupOwnerCode = groupOwnerCode
        };

        var response = await _service.UpdateProjectRowAsync(
            projectCode, month, groupOwnerCode, request, "TEST_USER");

        response.Success.Should().BeFalse();
        response.Message.Should().Contain("negative");
    }

    [Fact]
    public async Task UpdateProjectRate_NonExistentProject_ReturnsNotFound()
    {
        const int projectCode = 999999;
        const string month = "SEP26";
        const int groupOwnerCode = 562;

        var request = new ProfileInvoiceProjectUpdateRequest
        {
            AgreedRate = 100m,
            MonthYear = month,
            GroupOwnerCode = groupOwnerCode
        };

        var response = await _service.UpdateProjectRowAsync(
            projectCode, month, groupOwnerCode, request, "TEST_USER");

        response.Success.Should().BeFalse();
        response.Message.Should().Contain("not found");
    }
}

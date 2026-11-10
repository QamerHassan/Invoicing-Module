using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using RizvizInvoicing.Application.DTOs;

namespace RizvizInvoicing.Application.Interfaces;

public interface IInvoicingService
{
    // Company Invoicing
    Task<List<CompanyInvoiceDto>> GetCompanyInvoicesAsync(string monthYear, CancellationToken cancellationToken = default);
    Task<List<ProfileProjectDto>> GetProfileProjectsAsync(int? profileOwnerId = null, CancellationToken cancellationToken = default);
    Task<CalculateCompanyInvoicesResponse> CalculateCompanyInvoicesAsync(CalculateCompanyInvoicesRequest request, string username, CancellationToken cancellationToken = default);
    Task<bool> PostCompanyInvoicesAsync(string monthYear, bool replaceExisting, string username, CancellationToken cancellationToken = default);
    Task<byte[]> ExportCompanyInvoicesExcelAsync(string monthYear, CancellationToken cancellationToken = default);

    // Advance Funds
    Task<List<AdvanceFundDto>> GetAdvanceFundsAsync(string monthYear, CancellationToken cancellationToken = default);
    Task<AdvanceFundDto> CreateAdvanceFundAsync(CreateAdvanceFundRequest request, string username, CancellationToken cancellationToken = default);
    Task<bool> DeleteAdvanceFundAsync(int invoiceCode, string monthYear, CancellationToken cancellationToken = default);

    // Final Invoicing
    Task<FinalInvoiceCalculationResult> CalculateFinalInvoicePreviewAsync(string monthYear, CancellationToken cancellationToken = default);
    Task<FinalInvoiceDto> SaveFinalInvoiceAsync(string monthYear, string username, CancellationToken cancellationToken = default);
    Task<FinalInvoiceDto?> GetFinalInvoiceAsync(string monthYear, CancellationToken cancellationToken = default);

    // Dashboard & Billing Months
    Task<DashboardSummaryDto> GetDashboardSummaryAsync(string? month = null, CancellationToken cancellationToken = default);
    Task<List<string>> GetAvailableBillingMonthsAsync(CancellationToken cancellationToken = default);
}

using System;
using System.Collections.Generic;

namespace RizvizInvoicing.Application.DTOs;

public record CompanyInvoiceDto(
    int CmpInvoiceSeqCode,
    string InvoiceMonth,
    int InvoiceTo,
    string? VendorName,
    decimal? EntityCode,
    string? DeveloperName,
    int? ProjectCode,
    string? ProjectName,
    int? PrfownCode,
    string? ProfileOwnerName,
    string? ResourceType,
    decimal? ChargedAmtUsd,
    decimal? TotalIncomePkr,
    int? TotalUsdCost,
    decimal? ShareAmount,
    decimal? ExchangeRate,
    string? InvoiceNumber,
    string? Status,
    string? Remarks,
    int? ProRateDays,
    int? MonthDays,
    string? Stack = null,
    int? ProjectNumber = null,
    string? ServiceHead = null,
    decimal? UsdCost = null,
    decimal? RizvizShare = null,
    decimal? FinalUsd = null,
    decimal? TotalReceivableAmount = null,
    int? BranchCode = null,
    bool IsForeign = false,
    int? SecondaryDevCode = null,
    string? SecondaryDevName = null,
    int? InterviewCode = null,
    int? InterviewSeqCode = null,
    int? ChargTypeCode = null,
    string? SupportStatus = null,
    decimal? Arrears = null,
    int? Ccy = null
);

public record CalculateCompanyInvoicesRequest(
    string MonthYear,
    string Mode = "Bulk", // "Bulk" or "Single"
    int? ProfileOwnerId = null,
    bool ReplaceExisting = false
);

public record CalculateCompanyInvoicesResponse(
    string MonthYear,
    int TotalRows,
    decimal TotalChargedUsd,
    decimal TotalSilmunUsd,
    decimal TotalPaidExpCostUsd,
    decimal TotalPaidExpShareUsd,
    List<CompanyInvoiceDto> Rows
);

public record ProfileProjectDto(
    int PrfownCode,
    string ProfileOwner,
    int ProjectCode,
    string ProjectName,
    string ProjStatus,
    string DeveloperName,
    string? Shortcode = null
);

public record AdvanceFundDto(
    int InvoiceCode,
    string MonthYear,
    int? InvoiceTo,
    string? VendorName,
    decimal Amount,
    int Ccy,
    string CurrencyName,
    string? Remarks,
    DateTime? InsertTime,
    string? InsertBy
);

public record CreateAdvanceFundRequest(
    string MonthYear,
    int InvoiceTo,
    decimal Amount,
    int Ccy = 2,
    string? Remarks = null
);

public record FinalInvoiceDto(
    int InvCode,
    string MonthYear,
    int? InvoiceTo,
    string? VendorName,
    decimal SilmunInvoiceAmt,
    decimal PaidInvoiceAmt,
    decimal AdvancesFundAmt,
    decimal FinalInvoiceAmt,
    DateTime? InsertTime,
    string? InsertBy
);

public record FinalInvoiceCalculationResult(
    string MonthYear,
    decimal SilmunInvoiceAmt,     // Silmun total + Paid Exp Share
    decimal PaidInvoiceAmt,       // Direct vendor costs (invoice_to=2)
    decimal TotalAllRevenue,      // Silmun + Paid Expense Total
    decimal AdvancesFundAmt,      // Sum of advances
    decimal FinalInvoiceAmt,      // Silmun - Advances (Net Payable)
    bool HasCurrencyMismatch,
    int CompanyInvoiceRowCount,
    int AdvanceCount,
    bool IsFinalized = false,
    int? InvCode = null,
    string? InsertBy = null,
    DateTime? InsertTime = null,
    List<AdvanceFundDto>? AdvanceFunds = null
);

public record DashboardSummaryDto(
    decimal TotalInvoicedRevenueUsd,
    decimal TotalAdvanceReceivedUsd,
    decimal TotalAdvanceUtilizedUsd,
    decimal TotalOutstandingUsd,
    string LatestMonth,
    decimal TotalUsdCharged,
    decimal TotalPkrIncome,
    int ActiveInvoiceCount,
    List<MonthlyTrendDto> MonthlyTrends,
    List<TopCompanyDto> TopCompanies,
    List<TopCompanyDto> TopVendors,
    List<CompanyInvoiceDto> RecentInvoices,
    List<CompanyInvoiceDto> RecentCompanyInvoices,
    List<string>? AvailableMonths = null
);

public record MonthlyTrendDto(
    string MonthYear,
    decimal TotalInvoiced,
    decimal TotalAdvances,
    decimal NetFinal,
    decimal TotalChargedUsd = 0m,
    decimal TotalIncomePkr = 0m,
    int InvoiceCount = 0
);

public record TopCompanyDto(
    int VendorCode,
    string VendorName,
    decimal TotalChargedUsd,
    int InvoiceCount
);

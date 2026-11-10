using System;

namespace RizvizInvoicing.Domain.Entities;

public class ProfileInvoicing
{
    public int CmpProfInvoiceCode { get; set; }
    public decimal? EntityCode { get; set; }
    public int InvoiceTo { get; set; }
    public string InvoiceMonth { get; set; } = string.Empty;
    public decimal? ChargePercent { get; set; }
    public decimal? TotalIncomePkr { get; set; }
    public decimal? ChargedAmtPkr { get; set; }
    public decimal? ChargedAmtUsd { get; set; }
    public int? ExchangeRateCode { get; set; }
    public string? Status { get; set; }
    public string? Remarks { get; set; }
    public string InsertBy { get; set; } = string.Empty;
    public DateTime InsertTime { get; set; }
    public string? LastModifiedBy { get; set; }
    public DateTime? LastModifiedTime { get; set; }
    public DateTime? PostedDt { get; set; }
    public decimal? Arrears { get; set; }
    public string? Shortcode { get; set; }
    public decimal? ShareAmount { get; set; }
    public int? Ccy { get; set; }
    public int? InvoiceFrom { get; set; }
    public int? PrfownCode { get; set; }
    public int? PrfgrpOwnCode { get; set; }
    public string? ResourceType { get; set; }
    public int? ProjectCode { get; set; }
    public int? SecondaryDevCode { get; set; }
    public int? TotalUsdCost { get; set; }
    public string? InvoiceNumber { get; set; }
    public decimal? ExchangeRate { get; set; }
    public int? ChargTypeCode { get; set; }
    public string? SupportStatus { get; set; }
    public int? InterviewCode { get; set; }
    public int? InterviewSeqCode { get; set; }
    public int? MonthDays { get; set; }
    public int? ProRateDays { get; set; }
    public bool? IsIncluded { get; set; }
    public bool ToBeDiscussed { get; set; } = false;
    public string? DiscussNote { get; set; }
    public string? DiscussMarkedBy { get; set; }
    public DateTime? DiscussMarkedTime { get; set; }
    public bool IsProcessed { get; set; } = false;
}

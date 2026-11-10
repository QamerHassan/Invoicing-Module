using System;

namespace RizvizInvoicing.Domain.Entities;

public class InvoiceAdvanceFund
{
    public int InvoiceCode { get; set; }
    public string MonthYear { get; set; } = string.Empty;
    public int? InvoiceTo { get; set; }
    public decimal? Amount { get; set; }
    public int? Ccy { get; set; }
    public decimal? SilmunTotal { get; set; }
    public decimal? PaidExpense { get; set; }
    public decimal? TotalAdvance { get; set; }
    public decimal? TotalInvoice { get; set; }
    public string? Remarks { get; set; }
    public string? InsertBy { get; set; }
    public DateTime? InsertTime { get; set; }
    public string? UpdateBy { get; set; }
    public DateTime? UpdateTime { get; set; }
}

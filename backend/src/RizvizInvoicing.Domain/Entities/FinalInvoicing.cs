using System;

namespace RizvizInvoicing.Domain.Entities;

public class FinalInvoicing
{
    public int InvCode { get; set; }
    public string MonthYear { get; set; } = string.Empty;
    public int? InvoiceTo { get; set; }
    public decimal? SilmunInvoiceAmt { get; set; }
    public decimal? PaidInvoiceAmt { get; set; }
    public decimal? AdvancesFundAmt { get; set; }
    public decimal? FinalInvoiceAmt { get; set; }
    public string? InsertBy { get; set; }
    public DateTime? InsertTime { get; set; }
}

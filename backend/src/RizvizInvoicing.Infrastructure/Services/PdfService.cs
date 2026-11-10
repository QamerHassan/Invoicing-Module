using System;
using System.Collections.Generic;
using System.Linq;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RizvizInvoicing.Application.DTOs;

namespace RizvizInvoicing.Infrastructure.Services;

/// <summary>
/// Generates a server-side vector PDF document replicating the legacy PowerBuilder
/// d_rpt_final_invoice DataWindow ("SILMUN FINAL INVOICE & ADVANCE DEDUCTIONS REPORT") 1:1.
/// </summary>
public static class PdfService
{
    static PdfService()
    {
        // QuestPDF community license (free for non-enterprise / revenue < $1M/year)
        QuestPDF.Settings.License = LicenseType.Community;
    }

    public static byte[] GenerateFinalInvoicePdf(
        FinalInvoiceCalculationResult calc,
        FinalInvoiceDto? savedInvoice,
        List<AdvanceFundDto> advanceFunds)
    {
        string monthYear = calc.MonthYear;
        decimal silmunTotal = calc.SilmunInvoiceAmt;
        decimal paidExpensesTotal = calc.PaidInvoiceAmt;
        decimal totalAdvance = calc.AdvancesFundAmt;
        decimal finalPayable = calc.FinalInvoiceAmt;
        string insertBy = savedInvoice?.InsertBy ?? calc.InsertBy ?? "Admin";
        DateTime insertTime = savedInvoice?.InsertTime ?? calc.InsertTime ?? DateTime.Now;
        int? invCode = savedInvoice?.InvCode ?? calc.InvCode;

        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Arial"));

                page.Header().Column(col =>
                {
                    // Report Title matching d_rpt_final_invoice
                    col.Item().AlignCenter().Text("SILMUN FINAL INVOICE & ADVANCE DEDUCTIONS REPORT")
                        .Bold().FontSize(14).FontColor(Colors.Black);

                    col.Item().PaddingTop(6).LineHorizontal(2).LineColor(Colors.Black);

                    // Header Info Block matching d_rpt_final_invoice
                    col.Item().PaddingTop(8).PaddingBottom(8).Row(row =>
                    {
                        row.RelativeItem(3).Column(c =>
                        {
                            c.Item().Row(r =>
                            {
                                r.AutoItem().Text("Billing Month Year: ").Bold().FontSize(9);
                                r.AutoItem().Text(monthYear).Bold().FontSize(10).FontColor(Colors.Blue.Darken2);
                            });
                            if (invCode.HasValue)
                            {
                                c.Item().PaddingTop(2).Row(r =>
                                {
                                    r.AutoItem().Text("Invoice Code: ").FontSize(8).FontColor(Colors.Grey.Darken2);
                                    r.AutoItem().Text($"#{invCode.Value}").Bold().FontSize(8);
                                });
                            }
                        });

                        row.RelativeItem(4).AlignRight().Column(c =>
                        {
                            c.Item().Row(r =>
                            {
                                r.RelativeItem().AlignRight().Text("Silmun Total Invoice: ").Bold().FontSize(9);
                                r.ConstantItem(100).AlignRight().Text($"${silmunTotal:N2}").Bold().FontSize(10);
                            });
                            c.Item().PaddingTop(2).Row(r =>
                            {
                                r.RelativeItem().AlignRight().Text("Paid Expenses Total: ").Bold().FontSize(9);
                                r.ConstantItem(100).AlignRight().Text($"${paidExpensesTotal:N2}").Bold().FontSize(10);
                            });
                        });
                    });

                    col.Item().LineHorizontal(1.5f).LineColor(Colors.Black);
                });

                page.Content().PaddingTop(12).Column(col =>
                {
                    // Section Header matching d_rpt_final_invoice
                    col.Item().PaddingBottom(6).Text("ADVANCE RECEIVED DEDUCTIONS")
                        .Bold().FontSize(10).FontColor(Colors.Black);

                    // Table matching d_rpt_final_invoice columns: Company / Vendor, Currency, Advance Amount, Remarks
                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(cols =>
                        {
                            cols.RelativeColumn(3);     // Company / Vendor
                            cols.ConstantColumn(70);    // Currency
                            cols.ConstantColumn(110);   // Advance Amount
                            cols.RelativeColumn(4);     // Remarks
                        });

                        // Header Row
                        table.Header(h =>
                        {
                            h.Cell().BorderTop(1.5f).BorderBottom(1.5f).BorderColor(Colors.Black)
                                .PaddingVertical(4).PaddingHorizontal(2).Text("Company / Vendor").Bold().FontSize(8.5f);
                            h.Cell().BorderTop(1.5f).BorderBottom(1.5f).BorderColor(Colors.Black)
                                .AlignCenter().PaddingVertical(4).PaddingHorizontal(2).Text("Currency").Bold().FontSize(8.5f);
                            h.Cell().BorderTop(1.5f).BorderBottom(1.5f).BorderColor(Colors.Black)
                                .AlignRight().PaddingVertical(4).PaddingHorizontal(2).Text("Advance Amount").Bold().FontSize(8.5f);
                            h.Cell().BorderTop(1.5f).BorderBottom(1.5f).BorderColor(Colors.Black)
                                .PaddingVertical(4).PaddingHorizontal(4).Text("Remarks").Bold().FontSize(8.5f);
                        });

                        // Data Rows
                        if (advanceFunds != null && advanceFunds.Any())
                        {
                            foreach (var adv in advanceFunds)
                            {
                                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                                    .PaddingVertical(4).PaddingHorizontal(2).Text(adv.VendorName ?? $"Vendor #{adv.InvoiceTo}").FontSize(8.5f);

                                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                                    .AlignCenter().PaddingVertical(4).PaddingHorizontal(2).Text(adv.CurrencyName ?? "USD").FontSize(8.5f);

                                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                                    .AlignRight().PaddingVertical(4).PaddingHorizontal(2).Text($"${adv.Amount:N2}").FontSize(8.5f).FontFamily("Courier");

                                table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
                                    .PaddingVertical(4).PaddingHorizontal(4).Text(adv.Remarks ?? string.Empty).FontSize(8.5f);
                            }
                        }
                        else
                        {
                            table.Cell().ColumnSpan(4).PaddingVertical(8).AlignCenter()
                                .Text("No advance deductions recorded for this billing period.").Italic().FontColor(Colors.Grey.Medium);
                        }
                    });

                    // Summary Section matching d_rpt_final_invoice
                    col.Item().PaddingTop(10).Column(sum =>
                    {
                        sum.Item().LineHorizontal(1).LineColor(Colors.Black);

                        // Total Advance Deductions row
                        sum.Item().PaddingVertical(4).Row(r =>
                        {
                            r.RelativeItem().AlignRight().Text("Total Advance Deductions:").Bold().FontSize(9);
                            r.ConstantItem(120).AlignRight().Text($"${totalAdvance:N2}").Bold().FontSize(9.5f).FontFamily("Courier");
                            r.ConstantItem(20);
                        });

                        sum.Item().LineHorizontal(1).LineColor(Colors.Black);

                        // FINAL PAYABLE AMOUNT row
                        sum.Item().PaddingVertical(6).Row(r =>
                        {
                            r.RelativeItem().AlignRight().Text("FINAL PAYABLE AMOUNT (Silmun Total - Advance Deductions):")
                                .Bold().FontSize(9.5f).FontColor(Colors.Blue.Darken3);
                            r.ConstantItem(120).AlignRight().Text($"${finalPayable:N2}")
                                .Bold().FontSize(11).FontColor(Colors.Blue.Darken3).FontFamily("Courier");
                            r.ConstantItem(20);
                        });

                        sum.Item().LineHorizontal(2).LineColor(Colors.Black);
                        sum.Item().PaddingTop(1).LineHorizontal(1).LineColor(Colors.Black);
                    });

                    // Signatures / Audit
                    col.Item().PaddingTop(36).Row(sig =>
                    {
                        sig.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Prepared By:").FontSize(8).FontColor(Colors.Grey.Darken2);
                            c.Item().PaddingTop(2).Text(insertBy).Bold().FontSize(9);
                            c.Item().PaddingTop(16).LineHorizontal(0.5f).LineColor(Colors.Grey.Medium);
                            c.Item().PaddingTop(2).Text($"Date: {insertTime:yyyy-MM-dd HH:mm}").FontSize(7.5f).FontColor(Colors.Grey.Medium);
                        });

                        sig.ConstantItem(60);

                        sig.RelativeItem().Column(c =>
                        {
                            c.Item().Text("Verified & Approved By:").FontSize(8).FontColor(Colors.Grey.Darken2);
                            c.Item().PaddingTop(18).LineHorizontal(0.5f).LineColor(Colors.Grey.Medium);
                            c.Item().PaddingTop(2).Text("Authorized Signature").FontSize(7.5f).FontColor(Colors.Grey.Medium);
                        });
                    });
                });

                page.Footer().AlignCenter().Text(txt =>
                {
                    txt.Span("Generated by Rizviz Invoicing Suite  |  Legacy Replica: d_rpt_final_invoice  |  Page ");
                    txt.CurrentPageNumber();
                    txt.Span(" of ");
                    txt.TotalPages();
                });
            });
        }).GeneratePdf();
    }

    // Overload for backward compatibility with existing tests/callers
    public static byte[] GenerateFinalInvoicePdf(
        FinalInvoiceDto finalInvoice,
        List<CompanyInvoiceDto> companyRows,
        List<AdvanceFundDto> advanceFunds,
        string companyName = "Rizviz")
    {
        var calc = new FinalInvoiceCalculationResult(
            MonthYear: finalInvoice.MonthYear,
            SilmunInvoiceAmt: finalInvoice.SilmunInvoiceAmt,
            PaidInvoiceAmt: finalInvoice.PaidInvoiceAmt,
            TotalAllRevenue: finalInvoice.SilmunInvoiceAmt,
            AdvancesFundAmt: finalInvoice.AdvancesFundAmt,
            FinalInvoiceAmt: finalInvoice.FinalInvoiceAmt,
            HasCurrencyMismatch: false,
            CompanyInvoiceRowCount: companyRows?.Count ?? 0,
            AdvanceCount: advanceFunds?.Count ?? 0,
            IsFinalized: true,
            InvCode: finalInvoice.InvCode,
            InsertBy: finalInvoice.InsertBy,
            InsertTime: finalInvoice.InsertTime,
            AdvanceFunds: advanceFunds
        );

        return GenerateFinalInvoicePdf(calc, finalInvoice, advanceFunds ?? new List<AdvanceFundDto>());
    }
}

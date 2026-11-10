using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Services;
using Serilog;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/pdf")]
[Tags("Pdf")]
[Authorize]
public class PdfController : ControllerBase
{
    private readonly IInvoicingService _invoicingService;

    public PdfController(IInvoicingService invoicingService)
    {
        _invoicingService = invoicingService;
    }

    /// <summary>
    /// Generate and download a server-side vector PDF document replicating the PowerBuilder d_rpt_final_invoice report.
    /// </summary>
    [HttpGet("final-invoice")]
    [Produces("application/pdf")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> DownloadFinalInvoicePdf([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var preview = await _invoicingService.CalculateFinalInvoicePreviewAsync(monthYear, ct);
            var finalDto = await _invoicingService.GetFinalInvoiceAsync(monthYear, ct);
            var advRows = await _invoicingService.GetAdvanceFundsAsync(monthYear, ct);

            var pdfBytes = PdfService.GenerateFinalInvoicePdf(preview, finalDto, advRows);
            var fileName = $"Silmun_Final_Invoice_{monthYear.Replace("-", "").Trim()}.pdf";

            return File(pdfBytes, "application/pdf", fileName);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "PDF generation error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Retrieve structured invoice report data (summary, advance funds, live calculations) for browser print preview.
    /// </summary>
    [HttpGet("final-invoice/print-data")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetPrintData([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var preview = await _invoicingService.CalculateFinalInvoicePreviewAsync(monthYear, ct);
            var finalDto = await _invoicingService.GetFinalInvoiceAsync(monthYear, ct);
            var advRows = await _invoicingService.GetAdvanceFundsAsync(monthYear, ct);

            return Ok(new
            {
                Calculation = preview,
                Summary = finalDto,
                AdvanceFunds = advRows,
                GeneratedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "PrintData error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }
}

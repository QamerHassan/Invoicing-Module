using System;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using Serilog;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/final-invoice")]
[Tags("FinalInvoice")]
[Authorize]
public class FinalInvoiceController : ControllerBase
{
    private readonly IInvoicingService _invoicingService;

    public FinalInvoiceController(IInvoicingService invoicingService)
    {
        _invoicingService = invoicingService;
    }

    /// <summary>
    /// Preview real-time final invoice settlement calculations (Silmun + Paid Invoices - Advances = Final Payable).
    /// Does not commit to database.
    /// </summary>
    [HttpGet("preview")]
    [ProducesResponseType(typeof(FinalInvoiceCalculationResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetPreview([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var result = await _invoicingService.CalculateFinalInvoicePreviewAsync(monthYear, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "GetFinalInvoicePreview error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Retrieve saved final invoice settlement for the specified month from dbo.final_invoicing.
    /// Returns 200 with null if not yet finalized.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(FinalInvoiceDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetFinalInvoice([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var result = await _invoicingService.GetFinalInvoiceAsync(monthYear, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "GetFinalInvoice error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Finalize and save the final settlement into dbo.final_invoicing.
    /// Generates next InvCode atomically using dbo.NumberControl.
    /// </summary>
    [HttpPost("save")]
    [ProducesResponseType(typeof(FinalInvoiceDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> SaveFinalInvoice([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "system";
            var result = await _invoicingService.SaveFinalInvoiceAsync(monthYear, username, ct);
            return Created($"/api/final-invoice?monthYear={monthYear}", result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message, message = ex.Message });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "SaveFinalInvoice error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }
}

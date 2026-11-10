using System;
using System.Collections.Generic;
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
[Route("api/advance-funds")]
[Tags("AdvanceFunds")]
[Authorize]
public class AdvanceFundsController : ControllerBase
{
    private readonly IInvoicingService _invoicingService;

    public AdvanceFundsController(IInvoicingService invoicingService)
    {
        _invoicingService = invoicingService;
    }

    /// <summary>
    /// Retrieve all invoice advance fund disbursements for a specified month.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(List<AdvanceFundDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetAdvanceFunds([FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var result = await _invoicingService.GetAdvanceFundsAsync(monthYear, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "GetAdvanceFunds error for {MonthYear}: {Msg}", monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Record an advance fund payment/disbursement to a vendor for a month.
    /// Uses atomic sequence generation for invoice_code.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(AdvanceFundDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> CreateAdvanceFund([FromBody] CreateAdvanceFundRequest request, CancellationToken ct)
    {
        try
        {
            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "system";
            var result = await _invoicingService.CreateAdvanceFundAsync(request, username, ct);
            return Created($"/api/advance-funds?monthYear={request.MonthYear}", result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message, message = ex.Message });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "CreateAdvanceFund error for {MonthYear}: {Msg}", request.MonthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }

    /// <summary>
    /// Delete an advance fund entry by invoice code and month.
    /// </summary>
    [HttpDelete("{invoiceCode:int}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> DeleteAdvanceFund([FromRoute] int invoiceCode, [FromQuery] string monthYear, CancellationToken ct)
    {
        try
        {
            var deleted = await _invoicingService.DeleteAdvanceFundAsync(invoiceCode, monthYear, ct);
            return deleted ? Ok(new { success = true, invoiceCode, monthYear }) : NotFound(new { error = "Advance fund not found." });
        }
        catch (Exception ex)
        {
            var msg = ex.GetBaseException().Message;
            Log.Error(ex, "DeleteAdvanceFund error for {InvoiceCode} / {MonthYear}: {Msg}", invoiceCode, monthYear, msg);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = msg, message = msg });
        }
    }
}

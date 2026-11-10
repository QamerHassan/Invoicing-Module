using System;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RizvizInvoicing.Application.Interfaces;

namespace RizvizInvoicing.Api.Controllers;

[ApiController]
[Route("api/email-settings")]
[Tags("EmailSettings")]
[Authorize]
public class EmailSettingsController : ControllerBase
{
    private readonly IUserEmailSettingsService _emailSettingsService;
    private readonly ILogger<EmailSettingsController> _logger;

    public EmailSettingsController(
        IUserEmailSettingsService emailSettingsService,
        ILogger<EmailSettingsController> logger)
    {
        _emailSettingsService = emailSettingsService;
        _logger = logger;
    }

    private int? GetCurrentUserId()
    {
        var idStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(idStr, out var id) ? id : null;
    }

    /// <summary>
    /// Get saved sender email settings for the current user.
    /// Returns only { senderEmail, hasSavedPassword } - password is never returned.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId is null) return Unauthorized();

        var (senderEmail, hasSavedPassword) = await _emailSettingsService.GetAsync(userId.Value, ct);
        return Ok(new { senderEmail, hasSavedPassword });
    }

    /// <summary>
    /// Save (upsert) encrypted sender email settings for the current user.
    /// </summary>
    [HttpPut]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Save([FromBody] SaveEmailSettingsRequest request, CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId is null) return Unauthorized();

        if (string.IsNullOrWhiteSpace(request?.SenderEmail))
            return BadRequest(new { message = "Sender email is required." });

        if (string.IsNullOrWhiteSpace(request.AppPassword))
            return BadRequest(new { message = "App password is required." });

        if (!request.SenderEmail.Contains("@"))
            return BadRequest(new { message = "Enter a valid sender email address." });

        try
        {
            await _emailSettingsService.SaveAsync(userId.Value, request.SenderEmail, request.AppPassword, ct);
            return Ok(new { success = true, message = "Email settings saved." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save email settings for user {UserId}", userId);
            return BadRequest(new { message = "Failed to save email settings." });
        }
    }

    /// <summary>
    /// Remove saved sender email settings for the current user.
    /// </summary>
    [HttpDelete]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Delete(CancellationToken ct)
    {
        var userId = GetCurrentUserId();
        if (userId is null) return Unauthorized();

        await _emailSettingsService.DeleteAsync(userId.Value, ct);
        return Ok(new { success = true, message = "Email settings removed." });
    }
}

public class SaveEmailSettingsRequest
{
    public string SenderEmail { get; set; } = string.Empty;
    public string AppPassword { get; set; } = string.Empty;
}

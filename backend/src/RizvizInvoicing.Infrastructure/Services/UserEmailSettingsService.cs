using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Domain.Entities;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Infrastructure.Services;

public class UserEmailSettingsService : IUserEmailSettingsService
{
    private const string Purpose = "UserEmailSettings.AppPassword.v1";

    private readonly InvoicingDbContext _db;
    private readonly IDataProtector _protector;
    private readonly ILogger<UserEmailSettingsService> _logger;

    public UserEmailSettingsService(
        InvoicingDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        ILogger<UserEmailSettingsService> logger)
    {
        _db = db;
        _protector = dataProtectionProvider.CreateProtector(Purpose);
        _logger = logger;
    }

    public async Task<(string? SenderEmail, bool HasSavedPassword)> GetAsync(int userId, CancellationToken ct = default)
    {
        var row = await _db.UserEmailSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.UserId == userId, ct);

        if (row is null) return (null, false);
        return (row.SenderEmail, !string.IsNullOrWhiteSpace(row.EncryptedAppPassword));
    }

    public async Task<(string? SenderEmail, string? AppPassword)> GetDecryptedAsync(int userId, CancellationToken ct = default)
    {
        var row = await _db.UserEmailSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.UserId == userId, ct);

        if (row is null) return (null, null);

        try
        {
            string? decrypted = string.IsNullOrWhiteSpace(row.EncryptedAppPassword)
                ? null
                : _protector.Unprotect(row.EncryptedAppPassword);
            return (row.SenderEmail, decrypted);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to decrypt saved app password for user {UserId}: {Message}", userId, ex.Message);
            return (row.SenderEmail, null);
        }
    }

    public async Task SaveAsync(int userId, string senderEmail, string appPassword, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(senderEmail))
            throw new ArgumentException("Sender email is required.", nameof(senderEmail));
        if (string.IsNullOrWhiteSpace(appPassword))
            throw new ArgumentException("App password is required.", nameof(appPassword));

        string encrypted = _protector.Protect(appPassword.Replace(" ", "").Trim());

        var existing = await _db.UserEmailSettings.FirstOrDefaultAsync(x => x.UserId == userId, ct);
        if (existing is null)
        {
            _db.UserEmailSettings.Add(new UserEmailSettings
            {
                UserId = userId,
                SenderEmail = senderEmail.Trim(),
                EncryptedAppPassword = encrypted,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.SenderEmail = senderEmail.Trim();
            existing.EncryptedAppPassword = encrypted;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Saved email settings for user {UserId}", userId);
    }

    public async Task DeleteAsync(int userId, CancellationToken ct = default)
    {
        var existing = await _db.UserEmailSettings.FirstOrDefaultAsync(x => x.UserId == userId, ct);
        if (existing is not null)
        {
            _db.UserEmailSettings.Remove(existing);
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation("Removed email settings for user {UserId}", userId);
        }
    }
}

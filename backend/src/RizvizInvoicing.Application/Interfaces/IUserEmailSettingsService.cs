using System.Threading;
using System.Threading.Tasks;

namespace RizvizInvoicing.Application.Interfaces;

public interface IUserEmailSettingsService
{
    /// <summary>Returns sender email + whether a password is saved (never returns password).</summary>
    Task<(string? SenderEmail, bool HasSavedPassword)> GetAsync(int userId, CancellationToken ct = default);

    /// <summary>Save (upsert) encrypted sender settings for the user.</summary>
    Task SaveAsync(int userId, string senderEmail, string appPassword, CancellationToken ct = default);

    /// <summary>Get the decrypted app password for internal use only (never expose to client).</summary>
    Task<(string? SenderEmail, string? AppPassword)> GetDecryptedAsync(int userId, CancellationToken ct = default);

    /// <summary>Remove saved settings for the user.</summary>
    Task DeleteAsync(int userId, CancellationToken ct = default);
}

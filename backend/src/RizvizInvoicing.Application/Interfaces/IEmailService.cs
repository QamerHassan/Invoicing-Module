using System.Threading;
using System.Threading.Tasks;

namespace RizvizInvoicing.Application.Interfaces;

public interface IEmailService
{
    /// <summary>
    /// Send an email with an Excel attachment.
    /// Credential priority: (1) senderEmail+appPassword if both non-empty,
    /// (2) user saved settings from DB (resolved by caller via userId),
    /// (3) default SMTP config from appsettings/.env.
    /// </summary>
    Task SendEmailWithAttachmentAsync(
        string toEmail,
        string subject,
        string body,
        byte[] attachmentBytes,
        string attachmentFileName,
        string? replyToEmail = null,
        string? senderEmail = null,
        string? appPassword = null,
        CancellationToken ct = default);
}

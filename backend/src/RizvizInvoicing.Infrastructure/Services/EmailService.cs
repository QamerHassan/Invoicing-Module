using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MimeKit;
using RizvizInvoicing.Application.Interfaces;

namespace RizvizInvoicing.Infrastructure.Services;

public class EmailService : IEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration configuration, ILogger<EmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Detect SMTP host from sender email domain.
    /// Priority: explicit senderEmail domain > default config host.
    /// </summary>
    private string DetectSmtpHost(string senderEmail, string fallbackHost)
    {
        if (string.IsNullOrWhiteSpace(senderEmail)) return fallbackHost;
        var atIdx = senderEmail.IndexOf('@');
        if (atIdx < 0) return fallbackHost;
        var domain = senderEmail.Substring(atIdx + 1).Trim().ToLowerInvariant();
        return domain switch
        {
            "gmail.com" => "smtp.gmail.com",
            "outlook.com" or "hotmail.com" or "live.com" => "smtp-mail.outlook.com",
            "yahoo.com" or "yahoo.co.uk" or "ymail.com" => "smtp.mail.yahoo.com",
            _ => "smtp." + domain
        };
    }

    public async Task SendEmailWithAttachmentAsync(
        string toEmail,
        string subject,
        string body,
        byte[] attachmentBytes,
        string attachmentFileName,
        string? replyToEmail = null,
        string? senderEmail = null,
        string? appPassword = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(toEmail))
            throw new ArgumentException("Recipient email address (To) is required.", nameof(toEmail));

        if (string.IsNullOrWhiteSpace(subject))
            throw new ArgumentException("Email Subject is required.", nameof(subject));

        if (string.IsNullOrWhiteSpace(body))
            throw new ArgumentException("Email Body message is required.", nameof(body));

        // ── Read default sender credentials from Configuration / Environment (.env) ──
        string defaultEmail = Environment.GetEnvironmentVariable("SMTP_EMAIL")
            ?? Environment.GetEnvironmentVariable("SMTP_USER")
            ?? _configuration["Smtp:Email"]
            ?? _configuration["Smtp:User"]
            ?? "rizviz.invoicing@gmail.com";

        string defaultPassword = Environment.GetEnvironmentVariable("SMTP_PASSWORD")
            ?? Environment.GetEnvironmentVariable("SMTP_APP_PASSWORD")
            ?? _configuration["Smtp:AppPassword"]
            ?? _configuration["Smtp:Password"]
            ?? string.Empty;

        string defaultHost = Environment.GetEnvironmentVariable("SMTP_HOST")
            ?? _configuration["Smtp:Host"]
            ?? "smtp.gmail.com";

        int port = 587;
        string? portStr = Environment.GetEnvironmentVariable("SMTP_PORT") ?? _configuration["Smtp:Port"];
        if (!string.IsNullOrWhiteSpace(portStr) && int.TryParse(portStr, out int p)) port = p;

        string fromName = Environment.GetEnvironmentVariable("SMTP_FROM_NAME")
            ?? _configuration["Smtp:FromName"]
            ?? "Rizviz Invoicing";

        // ── Credential resolution: (1) Request > (2) Default config ──
        bool useCustomSender = !string.IsNullOrWhiteSpace(senderEmail) && !string.IsNullOrWhiteSpace(appPassword);

        string activeEmail    = useCustomSender ? senderEmail!.Trim() : defaultEmail.Trim();
        string activePassword = useCustomSender ? appPassword!.Replace(" ", "").Trim() : defaultPassword.Replace(" ", "").Trim();
        string activeFromName = useCustomSender ? activeEmail : fromName;
        string activeHost     = useCustomSender ? DetectSmtpHost(activeEmail, defaultHost) : defaultHost;

        if (string.IsNullOrWhiteSpace(activePassword))
        {
            throw new InvalidOperationException(
                "SMTP AppPassword is not configured. Set Smtp:AppPassword in appsettings.Development.json or SMTP_PASSWORD in .env.");
        }

        string trimmedTo = toEmail.Trim();

        // Security: passwords MUST NOT be logged
        _logger.LogInformation(
            "Sending email via MailKit from {FromEmail} (custom={Custom}) to {ToEmail} with subject '{Subject}' via {Host}:{Port}",
            activeEmail, useCustomSender, trimmedTo, subject, activeHost, port);

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(activeFromName, activeEmail));
        message.To.Add(MailboxAddress.Parse(trimmedTo));

        // Optional Reply-To
        if (!string.IsNullOrWhiteSpace(replyToEmail) && replyToEmail.Contains('@'))
        {
            try { message.ReplyTo.Add(MailboxAddress.Parse(replyToEmail.Trim())); }
            catch (Exception ex)
            {
                _logger.LogWarning("Could not parse reply-to address '{ReplyTo}': {Message}", replyToEmail, ex.Message);
            }
        }

        message.Subject = subject.Trim();

        var builder = new BodyBuilder { TextBody = body };

        if (attachmentBytes != null && attachmentBytes.Length > 0)
        {
            builder.Attachments.Add(
                attachmentFileName,
                attachmentBytes,
                ContentType.Parse("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        }

        message.Body = builder.ToMessageBody();

        using var client = new SmtpClient();
        try
        {
            await client.ConnectAsync(activeHost, port, SecureSocketOptions.StartTls, ct);
            await client.AuthenticateAsync(activeEmail, activePassword, ct);
            await client.SendAsync(message, ct);
            await client.DisconnectAsync(true, ct);

            _logger.LogInformation("Email successfully sent via MailKit to {ToEmail}", trimmedTo);
        }
        catch (AuthenticationException ex)
        {
            _logger.LogWarning("MailKit authentication failed for sender {FromEmail}: {Message}", activeEmail, ex.Message);
            throw new AuthenticationException(
                useCustomSender
                    ? "Aapke sender account ki settings galat hain. Sender Email aur App Password check karein."
                    : "Sender account ki settings galat hain, admin se rabta karo.",
                ex);
        }
        catch (SmtpCommandException ex)
        {
            _logger.LogWarning("MailKit SMTP command error for {ToEmail}: {StatusCode} - {Message}", trimmedTo, ex.StatusCode, ex.Message);
            throw;
        }
        finally
        {
            if (client.IsConnected)
            {
                try { await client.DisconnectAsync(false, CancellationToken.None); } catch { /* ignore */ }
            }
        }
    }
}

using System;

namespace RizvizInvoicing.Domain.Entities;

public class UserEmailSettings
{
    public int UserId { get; set; }
    public string SenderEmail { get; set; } = string.Empty;
    public string EncryptedAppPassword { get; set; } = string.Empty;
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

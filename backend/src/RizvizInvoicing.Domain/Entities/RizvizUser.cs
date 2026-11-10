namespace RizvizInvoicing.Domain.Entities;

public class RizvizUser
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty; // Legacy hash / plain text
    public string? PasswordHashV2 { get; set; }               // Additive upgraded PBKDF2/BCrypt hash
    public string? FullName { get; set; }
    public string? Email { get; set; }
    public string? RoleName { get; set; }
    public string? CompanyCode { get; set; }
    public string? BranchCode { get; set; }
    public bool IsActive { get; set; }
}

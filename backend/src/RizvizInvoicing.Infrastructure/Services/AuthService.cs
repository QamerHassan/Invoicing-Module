using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using RizvizInvoicing.Application.DTOs;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Infrastructure.Services;

public class AuthService : IAuthService
{
    private readonly InvoicingDbContext _context;
    private readonly IConfiguration _configuration;

    public AuthService(InvoicingDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return new AuthResponse(false, null, "Username and password are required.", null, null, null, null);
        }

        var user = await _context.RizvizUsers
            .FirstOrDefaultAsync(u => u.Username == request.Username.Trim(), cancellationToken);

        if (user == null || !user.IsActive)
        {
            return new AuthResponse(false, null, "Invalid username or password.", null, null, null, null);
        }

        bool isPasswordValid = false;

        // 1. If upgraded BCrypt hash exists, verify using BCrypt
        if (!string.IsNullOrWhiteSpace(user.PasswordHashV2))
        {
            isPasswordValid = BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHashV2);
        }
        else
        {
            // 2. Legacy check: plain-text or direct string equality
            if (user.PasswordHash == request.Password)
            {
                isPasswordValid = true;

                // Transparently upgrade password to BCrypt in additive column PasswordHashV2
                user.PasswordHashV2 = BCrypt.Net.BCrypt.HashPassword(request.Password);
                await _context.SaveChangesAsync(cancellationToken);
            }
        }

        if (!isPasswordValid)
        {
            return new AuthResponse(false, null, "Invalid username or password.", null, null, null, null);
        }

        // Generate JWT token
        var token = GenerateJwtToken(user);

        return new AuthResponse(
            Success: true,
            Token: token,
            Message: "Login successful",
            UserId: user.Id,
            Username: user.Username,
            FullName: user.FullName,
            Role: user.RoleName ?? "User"
        );
    }

    private string GenerateJwtToken(Domain.Entities.RizvizUser user)
    {
        var jwtSecret = _configuration["Jwt:Key"] ?? "RizvizInvoicingSystemSuperSecretKey2026!MustBe32BytesLong";
        var issuer = _configuration["Jwt:Issuer"] ?? "RizvizInvoicingApi";
        var audience = _configuration["Jwt:Audience"] ?? "RizvizInvoicingWeb";

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email ?? ""),
            new Claim(ClaimTypes.Role, user.RoleName ?? "User"),
            new Claim("FullName", user.FullName ?? user.Username)
        };

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(12),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

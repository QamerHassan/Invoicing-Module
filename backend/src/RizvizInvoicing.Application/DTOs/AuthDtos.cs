using System.Threading;
using System.Threading.Tasks;

namespace RizvizInvoicing.Application.DTOs;

public record LoginRequest(string Username, string Password);

public record AuthResponse(
    bool Success,
    string? Token,
    string? Message,
    int? UserId,
    string? Username,
    string? FullName,
    string? Role
);

using System.Threading;
using System.Threading.Tasks;
using RizvizInvoicing.Application.DTOs;

namespace RizvizInvoicing.Application.Interfaces;

public interface IAuthService
{
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
}

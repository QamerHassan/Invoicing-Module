using System.Threading;
using System.Threading.Tasks;

namespace RizvizInvoicing.Application.Interfaces;

public interface INumberSequenceService
{
    Task<long> GetNextSequenceAsync(string stageName, CancellationToken cancellationToken = default);
}

using System;
using System.Data;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;

namespace RizvizInvoicing.Infrastructure.Services;

public class NumberSequenceService : INumberSequenceService
{
    private readonly InvoicingDbContext _context;

    public NumberSequenceService(InvoicingDbContext context)
    {
        _context = context;
    }

    public async Task<long> GetNextSequenceAsync(string stageName, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(stageName))
            throw new ArgumentException("StageName cannot be empty.", nameof(stageName));

        var connection = _context.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        // Obtain underlying DbTransaction from EF's current transaction (if any)
        DbTransaction? currentTransaction = null;
        var efTx = _context.Database.CurrentTransaction;
        if (efTx != null)
            currentTransaction = efTx.GetDbTransaction();

        using var command = connection.CreateCommand();
        command.Transaction = currentTransaction;
        command.CommandText = @"
            UPDATE dbo.NumberControl WITH (UPDLOCK, ROWLOCK)
            SET LastNo = LastNo + 1
            OUTPUT INSERTED.LastNo
            WHERE StageName = @StageName;
        ";

        var param = command.CreateParameter();
        param.ParameterName = "@StageName";
        param.Value = stageName;
        command.Parameters.Add(param);

        var result = await command.ExecuteScalarAsync(cancellationToken);
        if (result != null && result != DBNull.Value)
        {
            return Convert.ToInt64(result);
        }

        // If stage record doesn't exist yet, insert with 1 atomically
        command.CommandText = @"
            IF NOT EXISTS (SELECT 1 FROM dbo.NumberControl WITH (UPDLOCK, HOLDLOCK) WHERE StageName = @StageName)
            BEGIN
                INSERT INTO dbo.NumberControl (StageName, LastNo) VALUES (@StageName, 1);
                SELECT CAST(1 AS bigint);
            END
            ELSE
            BEGIN
                UPDATE dbo.NumberControl WITH (UPDLOCK, ROWLOCK)
                SET LastNo = LastNo + 1
                OUTPUT INSERTED.LastNo
                WHERE StageName = @StageName;
            END
        ";

        var fallbackResult = await command.ExecuteScalarAsync(cancellationToken);
        if (fallbackResult != null && fallbackResult != DBNull.Value)
        {
            return Convert.ToInt64(fallbackResult);
        }

        throw new InvalidOperationException($"Failed to generate atomic sequence for StageName '{stageName}'.");
    }
}

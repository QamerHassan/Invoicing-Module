using System;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using RizvizInvoicing.Application.Interfaces;
using RizvizInvoicing.Infrastructure.Persistence;
using RizvizInvoicing.Infrastructure.Services;
using Serilog;

// ────────────────────────────────────────────────────────────────────────────
// Bootstrap Serilog
// ────────────────────────────────────────────────────────────────────────────
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File("logs/rizviz-.log",
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14)
    .CreateLogger();

try
{
    // Load .env file if present
    foreach (var envPath in new[] { ".env", "../.env", "../../.env", "../../../.env" })
    {
        if (System.IO.File.Exists(envPath))
        {
            foreach (var line in System.IO.File.ReadAllLines(envPath))
            {
                var trimmed = line.Trim();
                if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("#")) continue;
                var parts = trimmed.Split('=', 2);
                if (parts.Length == 2)
                {
                    var key = parts[0].Trim();
                    var val = parts[1].Trim().Trim('"').Trim('\'');
                    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                    {
                        Environment.SetEnvironmentVariable(key, val);
                    }
                }
            }
            break;
        }
    }

    var builder = WebApplication.CreateBuilder(args);
    builder.Host.UseSerilog();

    // ── Configuration ────────────────────────────────────────────────────────
    var configuration = builder.Configuration;

    var connString = configuration["ConnectionStrings:InvoicingDb"]
        ?? throw new InvalidOperationException(
            "ConnectionStrings:InvoicingDb is not set. Set it via user-secrets or environment variable.");

    // Normalize any double backslashes in instance names (e.g. from .env or JSON escaping)
    connString = connString.Replace(@"\\", @"\");

    try
    {
        var csb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connString);
        Log.Information(">>> DATABASE CONNECTION INITIALIZED: Server='{Server}', Database='{Database}', User='{User}' <<<",
            csb.DataSource, csb.InitialCatalog, csb.UserID);
    }
    catch (Exception csEx)
    {
        Log.Warning("Failed to parse connection string for logging: {Message}", csEx.Message);
    }

    var jwtKey      = configuration["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key is not set.");
    var jwtIssuer   = configuration["Jwt:Issuer"] ?? "RizvizInvoicingApi";
    var jwtAudience = configuration["Jwt:Audience"] ?? "RizvizInvoicingWeb";

    // ── Database ─────────────────────────────────────────────────────────────
    // Tune connection string for speed: larger pool, faster timeout
    var csb2 = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connString);
    csb2.MinPoolSize = 3;
    csb2.MaxPoolSize = 20;
    csb2.ConnectTimeout = 15;
    csb2.CommandTimeout = 45;
    csb2.ApplicationName = "RizvizInvoicingApi";
    var tunedConnStr = csb2.ToString();

    builder.Services.AddDbContext<InvoicingDbContext>(opt =>
        opt.UseSqlServer(tunedConnStr, sql =>
        {
            sql.CommandTimeout(45);
            sql.EnableRetryOnFailure(2, TimeSpan.FromSeconds(2), null);
        }));

    // ── In-Memory Cache (for lookups, billing months, etc.) ─────────────────
    builder.Services.AddMemoryCache(opt =>
    {
        opt.SizeLimit = 1024; // entries
        opt.ExpirationScanFrequency = TimeSpan.FromMinutes(5);
    });

    // ── Response Compression ─────────────────────────────────────────────────
    builder.Services.AddResponseCompression(opt =>
    {
        opt.EnableForHttps = true;
    });

    // ── Application Services ─────────────────────────────────────────────────
    builder.Services.AddScoped<IAuthService, AuthService>();
    builder.Services.AddScoped<INumberSequenceService, NumberSequenceService>();
    builder.Services.AddScoped<IInvoicingService, InvoicingService>();
    builder.Services.AddScoped<IProfileInvoicingService, ProfileInvoicingService>();
    builder.Services.AddScoped<IEmailService, EmailService>();
    builder.Services.AddScoped<IUserEmailSettingsService, UserEmailSettingsService>();

    // ASP.NET Core Data Protection (for encrypting saved app passwords)
    builder.Services.AddDataProtection();

    // ── Controllers ──────────────────────────────────────────────────────────
    builder.Services.AddControllers();

    // ── JWT Authentication ───────────────────────────────────────────────────
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(opt =>
        {
            opt.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer           = true,
                ValidateAudience         = true,
                ValidateLifetime         = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer              = jwtIssuer,
                ValidAudience            = jwtAudience,
                IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
                ClockSkew                = TimeSpan.Zero
            };
        });
    builder.Services.AddAuthorization();

    // ── CORS ─────────────────────────────────────────────────────────────────
    builder.Services.AddCors(opt => opt.AddPolicy("AllowFrontend", policy =>
    {
        var customOrigins = configuration["ALLOWED_ORIGINS"]?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? Array.Empty<string>();
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrEmpty(origin)) return false;
            if (Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            {
                return uri.Host == "localhost" ||
                       uri.Host == "127.0.0.1" ||
                       uri.Host.EndsWith(".vercel.app") ||
                       customOrigins.Contains(origin);
            }
            return false;
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
    }));

    // ── Swagger / OpenAPI ────────────────────────────────────────────────────
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(c =>
    {
        c.SwaggerDoc("v1", new OpenApiInfo
        {
            Title = "Rizviz Invoicing API",
            Version = "v1",
            Description = "Modern enterprise REST API for the Rizviz Invoicing System (migrated from legacy PowerBuilder application)."
        });

        // 3. JWT Bearer security definition for the Authorize button
        c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
        {
            Name = "Authorization",
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "JWT Authorization header using the Bearer scheme.\r\n\r\nPaste your JWT token below directly (without 'Bearer ' prefix)."
        });

        c.AddSecurityRequirement(new OpenApiSecurityRequirement
        {
            {
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference
                    {
                        Type = ReferenceType.SecurityScheme,
                        Id = "Bearer"
                    }
                },
                Array.Empty<string>()
            }
        });

        var xmlFile = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
        var xmlPath = System.IO.Path.Combine(AppContext.BaseDirectory, xmlFile);
        if (System.IO.File.Exists(xmlPath))
        {
            c.IncludeXmlComments(xmlPath);
        }
    });

    // ── Build App ─────────────────────────────────────────────────────────────
    var app = builder.Build();

    app.UseResponseCompression();
    app.UseSerilogRequestLogging();
    app.UseCors("AllowFrontend");

    // 2. Swagger enabled in Development (and available when enabled via config)
    if (app.Environment.IsDevelopment() || configuration.GetValue<bool>("EnableSwagger", true))
    {
        app.UseSwagger();
        app.UseSwaggerUI(c =>
        {
            c.SwaggerEndpoint("/swagger/v1/swagger.json", "Rizviz Invoicing API v1");
            c.RoutePrefix = "swagger";
            c.DisplayRequestDuration();
            c.EnablePersistAuthorization();
            c.DocExpansion(Swashbuckle.AspNetCore.SwaggerUI.DocExpansion.List);
        });
    }

    app.UseHttpsRedirection();
    app.UseAuthentication();
    app.UseAuthorization();

    // 1. Map Controllers
    app.MapControllers();

    // Root endpoint for platform health checks (Back4App, Render, etc.)
    app.MapGet("/", () => Results.Ok(new { status = "healthy", app = "Rizviz Invoicing API" })).AllowAnonymous();

    // Health check endpoint with real DB connectivity and name
    app.MapGet("/health", (InvoicingDbContext db) =>
    {
        try
        {
            var conn = db.Database.GetDbConnection();
            var csb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(conn.ConnectionString);
            bool canConnect = db.Database.CanConnect();
            return Results.Ok(new
            {
                status = canConnect ? "healthy" : "unhealthy",
                connected = canConnect,
                server = csb.DataSource,
                database = csb.InitialCatalog,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            return Results.Ok(new
            {
                status = "unhealthy",
                connected = false,
                database = "Unknown",
                error = ex.Message,
                timestamp = DateTime.UtcNow
            });
        }
    })
    .WithName("HealthCheck")
    .WithTags("System")
    .AllowAnonymous();

    // System DB info endpoint for frontend footer status
    app.MapGet("/api/system/db-info", (InvoicingDbContext db) =>
    {
        try
        {
            var conn = db.Database.GetDbConnection();
            var csb = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(conn.ConnectionString);
            bool canConnect = db.Database.CanConnect();
            return Results.Ok(new
            {
                connected = canConnect,
                server = csb.DataSource,
                database = csb.InitialCatalog
            });
        }
        catch (Exception ex)
        {
            return Results.Ok(new
            {
                connected = false,
                database = "Error",
                server = "Unknown",
                error = ex.Message
            });
        }
    })
    .WithName("SystemDbInfo")
    .WithTags("System")
    .AllowAnonymous();

    // ── DB Warm-up: pre-open connection pool on startup to eliminate cold-start lag ──
    _ = Task.Run(async () =>
    {
        try
        {
            await Task.Delay(500); // let app fully start first
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<InvoicingDbContext>();
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1";
            await cmd.ExecuteScalarAsync();
            await conn.CloseAsync();
            Log.Information("DB connection pool warmed up successfully.");
        }
        catch (Exception ex)
        {
            Log.Warning("DB warm-up failed (non-fatal): {Msg}", ex.Message);
        }
    });

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application startup failed");
    throw;
}
finally
{
    Log.CloseAndFlush();
}

# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy solution and csproj files for layer caching
COPY backend/RizvizInvoicing.sln ./backend/
COPY backend/src/RizvizInvoicing.Domain/*.csproj ./backend/src/RizvizInvoicing.Domain/
COPY backend/src/RizvizInvoicing.Application/*.csproj ./backend/src/RizvizInvoicing.Application/
COPY backend/src/RizvizInvoicing.Infrastructure/*.csproj ./backend/src/RizvizInvoicing.Infrastructure/
COPY backend/src/RizvizInvoicing.Api/*.csproj ./backend/src/RizvizInvoicing.Api/
COPY backend/tests/RizvizInvoicing.Tests/*.csproj ./backend/tests/RizvizInvoicing.Tests/

RUN dotnet restore backend/RizvizInvoicing.sln

# Copy everything else and build
COPY backend/ ./backend/
WORKDIR /src/backend/src/RizvizInvoicing.Api
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000

ENTRYPOINT ["dotnet", "RizvizInvoicing.Api.dll"]

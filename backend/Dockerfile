# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY RizvizInvoicing.sln ./
COPY src/RizvizInvoicing.Domain/*.csproj ./src/RizvizInvoicing.Domain/
COPY src/RizvizInvoicing.Application/*.csproj ./src/RizvizInvoicing.Application/
COPY src/RizvizInvoicing.Infrastructure/*.csproj ./src/RizvizInvoicing.Infrastructure/
COPY src/RizvizInvoicing.Api/*.csproj ./src/RizvizInvoicing.Api/
COPY tests/RizvizInvoicing.Tests/*.csproj ./tests/RizvizInvoicing.Tests/

RUN dotnet restore RizvizInvoicing.sln

COPY . .
WORKDIR /src/src/RizvizInvoicing.Api
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_HTTP_PORTS=10000
ENV ASPNETCORE_URLS=http://+:10000
EXPOSE 10000

ENTRYPOINT ["dotnet", "RizvizInvoicing.Api.dll"]


$loginResp = Invoke-WebRequest -Uri 'https://invoicingmodule-c2fxnqua.back4.app/api/auth/login' -Method POST -Body '{"username":"admin","password":"admin123"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 15
$token = ($loginResp.Content | ConvertFrom-Json).token

$start = Get-Date
$resp = Invoke-WebRequest -Uri 'https://invoicingmodule-c2fxnqua.back4.app/api/profile-invoices/excel-view?groupOwnerCode=6&monthYear=OCT26' -Headers @{Authorization = "Bearer $token"} -UseBasicParsing -TimeoutSec 30
$elapsed = ((Get-Date) - $start).TotalMilliseconds

$data = $resp.Content | ConvertFrom-Json
Write-Host "STATUS: $($resp.StatusCode), Time: $elapsed ms"
Write-Host "Group Owner: $($data.groupOwnerName) ($($data.groupOwnerCode))"
Write-Host "Total Invoice: $($data.totalInvoiceUsd)"
Write-Host "Total Rows: $($data.rows.Count)"
Write-Host "Total Agreed: $($data.totalAgreed)"
Write-Host "Total Actual: $($data.totalActual)"
Write-Host "Total Other: $($data.totalOther)"


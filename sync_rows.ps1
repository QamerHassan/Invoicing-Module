$srcConnStr = "Server=DESKTOP-7S0EFN4\SQLEXPRESS;Database=Invoicing_System;User Id=InvoicingAppUser;Password=Inv@pp2026!Secure;TrustServerCertificate=True;"
$dstConnStr = "Server=rizviz-db.c9o28ky2q7ah.ap-southeast-2.rds.amazonaws.com,1433;Database=Invoicing_System;User Id=admin;Password=Rizviz5121472;TrustServerCertificate=True;"

$srcConn = New-Object System.Data.SqlClient.SqlConnection($srcConnStr)
$srcConn.Open()
$cmd = $srcConn.CreateCommand()
$cmd.CommandText = "SELECT * FROM dbo.Profile_invoicing WHERE prfgrp_own_code = 6 AND REPLACE(RTRIM(invoice_month), '-', '') = 'OCT26'"
$adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
$dt = New-Object System.Data.DataTable
$adapter.Fill($dt) | Out-Null
$srcConn.Close()

Write-Host "Exported $($dt.Rows.Count) rows from local."

$dstConn = New-Object System.Data.SqlClient.SqlConnection($dstConnStr)
$dstConn.Open()

# Build column list and param list
$colList = @()
$paramList = @()
foreach ($col in $dt.Columns) {
    $colList += "[$($col.ColumnName)]"
    $paramList += "@$($col.ColumnName)"
}
$insertSql = "INSERT INTO dbo.Profile_invoicing ($($colList -join ',')) VALUES ($($paramList -join ','))"

$insCmd = $dstConn.CreateCommand()
$insCmd.CommandTimeout = 120
$insCmd.CommandText = $insertSql
foreach ($col in $dt.Columns) {
    $p = New-Object System.Data.SqlClient.SqlParameter("@$($col.ColumnName)", [System.DBNull]::Value)
    $insCmd.Parameters.Add($p) | Out-Null
}

$count = 0
foreach ($row in $dt.Rows) {
    foreach ($col in $dt.Columns) {
        $val = $row[$col.ColumnName]
        $insCmd.Parameters["@$($col.ColumnName)"].Value = if ($val -eq [System.DBNull]::Value) { [System.DBNull]::Value } else { $val }
    }
    $insCmd.ExecuteNonQuery() | Out-Null
    $count++
}

$dstConn.Close()
Write-Host "SUCCESS! Inserted $count rows into RDS!"


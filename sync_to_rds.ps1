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

Write-Host "Loaded $($dt.Rows.Count) rows from Local DB."

$dstConn = New-Object System.Data.SqlClient.SqlConnection($dstConnStr)
$dstConn.Open()

$bulk = New-Object System.Data.SqlClient.SqlBulkCopy($dstConn)
$bulk.BulkCopyTimeout = 300
$bulk.DestinationTableName = "dbo.Profile_invoicing"
foreach ($col in $dt.Columns) {
    $bulk.ColumnMappings.Add($col.ColumnName, $col.ColumnName) | Out-Null
}
$bulk.WriteToServer($dt)
$dstConn.Close()

Write-Host "Successfully synced $($dt.Rows.Count) rows to RDS!"

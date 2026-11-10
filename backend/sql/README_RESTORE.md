# Rizviz Invoicing – Database Restore & Custom Schema Playbook

Yeh guide database restore hone ke baad modern (.NET 8 + React) features ki schema aur permissions ko 1 click mein apply karne ke liye hai.

---

## 📌 Background

Jab aap legacy PowerBuilder database ka `.bak` backup SQL Server par restore karte hain, toh us database mein modern application ke banaye hue custom tables, columns, indexes aur permissions maujood nahi hote.

Aapko code ya UI mein koi tabdeeli karne ki zaroorat nahi hai. Sirf **ek master script** chalane se poora modern schema ready ho jayega.

---

## 🗂️ Files in this Directory

| File | Purpose |
| :--- | :--- |
| **`00_restore_custom_schema.sql`** | **Master Idempotent Script**: Naye tables, columns, constraints, indexes, backfill aur permissions banata hai. Isko jitni dafa bhi chalayein, koi error ya data loss nahi hota. |
| **`01_verify_custom_schema.sql`** | **Verification Script**: 18-point checklist verify karta hai aur `OK` ya `MISSING` ka status table output deta hai. |
| **`README_RESTORE.md`** | Yeh documentation file. |

---

## 📋 Custom Objects Inventory

Neeche un tamam custom objects ki list hai jo master script restore karta hai:

| # | Object Name | Type | Feature / Purpose | Used By |
|---|---|---|---|---|
| 1 | `dbo.Rizviz_Users` | Table | JWT Authentication & User management (Admin, HR, etc.) | `InvoicingDbContext`, `AuthService`, `AuthController` |
| 2 | `dbo.Rizviz_Users.PasswordHashV2` | Column (`NVARCHAR(256)`) | BCrypt secure password hash upgrade | `AuthService.cs` |
| 3 | `dbo.UserEmailSettings` | Table | User-specific SMTP settings & encrypted app passwords | `UserEmailSettingsService`, `EmailSettingsController` |
| 4 | `dbo.profile_invoice_audit_log` | Table | Change tracking audit log for profile invoicing & projects | `ProfileInvoicingService`, `ProfileInvoicesController`, `ProfileInvoiceAuditTab.tsx` |
| 5 | `dbo.profile_invoice_audit_log.project_code` | Column (`INT`) | Project-level inline edits audit tracking | `ProfileInvoicingService.cs` |
| 6 | `dbo.Profile_invoicing.is_included` | Column (`BIT NULL`, Def: `1`) | Profile Invoicing inclusion checkbox toggle | `ProfileInvoicingService`, `ProfileInvoiceExcelView.tsx` |
| 7 | `dbo.Profile_invoicing.to_be_discussed` | Column (`BIT NOT NULL`, Def: `0`) | "To Be Discussed" sub-tab flag | `ProfileInvoicingService`, `ProfileInvoiceDiscussTab.tsx` |
| 8 | `dbo.Profile_invoicing.discuss_note` | Column (`NVARCHAR(500)`) | Discussion comments & notes | `ProfileInvoicingService.cs` |
| 9 | `dbo.Profile_invoicing.discuss_marked_by`| Column (`NVARCHAR(100)`) | Username jo record ko discussion mein mark karta hai | `ProfileInvoicingService.cs` |
| 10 | `dbo.Profile_invoicing.discuss_marked_time`| Column (`DATETIME2`) | Timestamp jab discussion flag lagaya gaya | `ProfileInvoicingService.cs` |
| 11 | `dbo.Profile_invoicing.is_processed` | Column (`BIT NOT NULL`, Def: `0`) | Processed status flag (active Excel view se processed view mein move karta hai) | `ProfileInvoicingService.cs`, `ProfileInvoiceExcelView.tsx`, `ProfileInvoiceProcessedTab.tsx` |
| 12 | `mkt.Projects.branch_code` | Column (`INT NULL`) | Foreign branch identification (e.g. `branch_code = 5` is Foreign) | `ProfileInvoicingService`, `SupportingEntities.cs` |
| 13 | `IX_Profile_invoicing_month_owner` | Index | Quick lookup for profile owner and month queries | SQL Server Engine |
| 14 | `IX_Profile_invoicing_to_be_discussed` | Index | Fast filtering for To Be Discussed sub-tab | SQL Server Engine |
| 15 | `IX_profile_invoice_audit_log_lookup` | Index | High-speed audit log retrieval & filtering | SQL Server Engine |
| 16 | `[InvoicingAppUser]` | DB Principal & Roles | `db_datareader`, `db_datawriter`, `GRANT EXECUTE` (NO DDL/ALTER) | Backend API DB Connection |

---

## 🚀 Step-by-Step Restoration Procedure

### Step 1: Database Restore Karein
SQL Server Management Studio (SSMS) mein `.bak` file restore karein:
- Database Name: `Invoicing_System` (ya test DB `Invoicing_System_Verify`).

### Step 2: Master Schema Script Run Karein
1. SSMS mein **`backend/sql/00_restore_custom_schema.sql`** open karein.
2. Available Databases dropdown se apna restored database select karein (`Invoicing_System`).
3. **Execute (F5)** dabayein.
4. Output Messages window mein dekhein ke sab steps success ke sath complete hon:
   ```text
   Starting Rizviz Invoicing custom schema restoration on database: [Invoicing_System]
   ...
   Rizviz Invoicing custom schema restoration finished successfully!
   ```

### Step 3: Verification Script Run Karein
1. SSMS mein **`backend/sql/01_verify_custom_schema.sql`** open karein.
2. Selected DB par **Execute (F5)** dabayein.
3. Grid result mein sabhi **19 checks** par status `OK` nazar aana chahiye:
   ```text
   Verification Summary: 19 / 19 checks PASSED.
   ALL CHECKS PASSED. Database is fully compatible with Rizviz Invoicing modern application!
   ```

### Step 4: Backend API Restart Karein
Schema update hone ke baad backend API ko restart karein taake connection pool aur EF metadata fresh refresh ho:
```powershell
# PowerShell / Terminal:
cd "f:\Users\Qamer Hassan\RizvizInvoicing\backend"
dotnet run --project src\RizvizInvoicing.Api\RizvizInvoicing.Api.csproj
```

---

## ⚠️ Important Note: Historical Data vs Schema

> [!IMPORTANT]
> **Data vs. Structure**:
> Yeh script sirf **schema structure** (tables, columns, indexes, permissions, default admin users) banata hai aur naye columns par standard initial defaults (Executive = 0, others = 1) backfill karta hai.
> 
> Purana audit trail data (`profile_invoice_audit_log` ke historical records), users ke pehle se likhe hue `discuss_note`, aur users ke save kiye hue email app passwords (`UserEmailSettings`) **sirf aapke database backup (.bak) se aayenge**, is script se generate nahi honge.

---

## 💡 Optional: Auto-Apply in Development Startup (STEP 5)

Agar aap chahein ke development mode (`ASPNETCORE_ENVIRONMENT=Development`) mein jab bhi backend start ho, wo automatic check kare aur yeh idempotent script apply kar de (bina SSMS khole), toh `Program.cs` mein startup pipeline ke andar ek method add kiya ja sakta hai.

### Kaise Kaam Karega?
1. `Program.cs` mein `app.Environment.IsDevelopment()` ke block ke andar raw SQL execution call hoga:
   ```csharp
   if (app.Environment.IsDevelopment())
   {
       using var scope = app.Services.CreateScope();
       var db = scope.ServiceProvider.GetRequiredService<InvoicingDbContext>();
       var sqlPath = Path.Combine(app.Environment.ContentRootPath, "..", "sql", "00_restore_custom_schema.sql");
       if (File.Exists(sqlPath))
       {
           var script = await File.ReadAllTextAsync(sqlPath);
           await db.Database.ExecuteSqlRawAsync(script);
       }
   }
   ```
2. **Fayda**: Jab bhi koi naya developer repo clone kare ya fresh DB restore kare, app run karte hi missing columns aur tables auto-create ho jayenge.
3. **Safety**: Script completely idempotent hai (`IF NOT EXISTS` / `IF COL_LENGTH(...) IS NULL`), isliye har dafa chalne se koi data loss nahi hota.
4. **Note**: Production mein isay hamesha manual script (SSMS / DBA) ke zariye chalana chahiye.


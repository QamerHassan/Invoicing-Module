using Microsoft.EntityFrameworkCore;
using RizvizInvoicing.Domain.Entities;

namespace RizvizInvoicing.Infrastructure.Persistence;

public class InvoicingDbContext : DbContext
{
    public InvoicingDbContext(DbContextOptions<InvoicingDbContext> options) : base(options)
    {
    }

    public DbSet<CompanyInvoicing> CompanyInvoices => Set<CompanyInvoicing>();
    public DbSet<InvoiceAdvanceFund> InvoiceAdvanceFunds => Set<InvoiceAdvanceFund>();
    public DbSet<FinalInvoicing> FinalInvoices => Set<FinalInvoicing>();
    public DbSet<ProfileInvoicing> ProfileInvoices => Set<ProfileInvoicing>();
    public DbSet<NumberControl> NumberControls => Set<NumberControl>();
    public DbSet<RizvizUser> RizvizUsers => Set<RizvizUser>();
    public DbSet<Vendor> Vendors => Set<Vendor>();
    public DbSet<ExchangeRate> ExchangeRates => Set<ExchangeRate>();
    public DbSet<ProfileOwner> ProfileOwners => Set<ProfileOwner>();
    public DbSet<ProfileGrpOwner> ProfileGrpOwners => Set<ProfileGrpOwner>();
    public DbSet<HrmsEntity> HrmsEntities => Set<HrmsEntity>();
    public DbSet<MktProject> MktProjects => Set<MktProject>();
    public DbSet<MktProjectInvoicing> MktProjectInvoices => Set<MktProjectInvoicing>();
    public DbSet<SetupStack> SetupStacks => Set<SetupStack>();
    public DbSet<EntityTeamstructure> EntityTeamstructures => Set<EntityTeamstructure>();
    public DbSet<EmpRole> EmpRoles => Set<EmpRole>();
    public DbSet<UserEmailSettings> UserEmailSettings => Set<UserEmailSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // 1. CompanyInvoicing -> dbo.company_invoicing
        modelBuilder.Entity<CompanyInvoicing>(entity =>
        {
            entity.ToTable("company_invoicing", "dbo");
            entity.HasKey(e => e.CmpInvoiceSeqCode);
            entity.Property(e => e.CmpInvoiceSeqCode).HasColumnName("cmp_invoice_seq_code").ValueGeneratedNever();
            entity.Property(e => e.EntityCode).HasColumnName("entity_code").HasColumnType("numeric(38,0)");
            entity.Property(e => e.InvoiceTo).HasColumnName("invoice_to");
            entity.Property(e => e.InvoiceMonth).HasColumnName("invoice_month").HasMaxLength(7).IsFixedLength();
            entity.Property(e => e.ChargePercent).HasColumnName("charge_percent").HasColumnType("decimal(5,2)");
            entity.Property(e => e.TotalIncomePkr).HasColumnName("total_income_pkr").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargedAmtPkr).HasColumnName("charged_amt_pkr").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargedAmtUsd).HasColumnName("charged_amt_usd").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ExchangeRateCode).HasColumnName("exchange_rate_code");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.Remarks).HasColumnName("remarks").HasMaxLength(300);
            entity.Property(e => e.InsertBy).HasColumnName("insert_by").HasMaxLength(20);
            entity.Property(e => e.InsertTime).HasColumnName("insert_time");
            entity.Property(e => e.LastModifiedBy).HasColumnName("last_modified_by").HasMaxLength(50);
            entity.Property(e => e.LastModifiedTime).HasColumnName("last_modified_time");
            entity.Property(e => e.PostedDt).HasColumnName("posted_dt");
            entity.Property(e => e.Arrears).HasColumnName("Arrears").HasColumnType("decimal(18,2)");
            entity.Property(e => e.Shortcode).HasColumnName("shortcode").HasMaxLength(30);
            entity.Property(e => e.ShareAmount).HasColumnName("share_amount").HasColumnType("decimal(5,2)");
            entity.Property(e => e.Ccy).HasColumnName("ccy");
            entity.Property(e => e.InvoiceFrom).HasColumnName("invoice_from");
            entity.Property(e => e.PrfownCode).HasColumnName("prfown_code");
            entity.Property(e => e.ResourceType).HasColumnName("resource_type").HasMaxLength(2).IsFixedLength();
            entity.Property(e => e.ProjectCode).HasColumnName("project_code");
            entity.Property(e => e.SecondaryDevCode).HasColumnName("secondary_dev_code");
            entity.Property(e => e.TotalUsdCost).HasColumnName("total_usd_cost");
            entity.Property(e => e.InvoiceNumber).HasColumnName("invoice_number").HasMaxLength(20);
            entity.Property(e => e.ExchangeRate).HasColumnName("exchange_rate").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargTypeCode).HasColumnName("charg_type_code");
            entity.Property(e => e.SupportStatus).HasColumnName("support_status").HasMaxLength(2).IsFixedLength();
            entity.Property(e => e.InterviewCode).HasColumnName("interview_code");
            entity.Property(e => e.InterviewSeqCode).HasColumnName("interview_seq_code");
            entity.Property(e => e.ProRateDays).HasColumnName("pro_rate_days");
            entity.Property(e => e.MonthDays).HasColumnName("month_days");
        });

        // 2. InvoiceAdvanceFund -> dbo.invoice_advance_funds
        modelBuilder.Entity<InvoiceAdvanceFund>(entity =>
        {
            entity.ToTable("invoice_advance_funds", "dbo");
            entity.HasKey(e => new { e.InvoiceCode, e.MonthYear });
            entity.Property(e => e.InvoiceCode).HasColumnName("invoice_code").ValueGeneratedNever();
            entity.Property(e => e.MonthYear).HasColumnName("month_year").HasMaxLength(10);
            entity.Property(e => e.InvoiceTo).HasColumnName("invoice_to");
            entity.Property(e => e.Amount).HasColumnName("amount").HasColumnType("decimal(18,2)");
            entity.Property(e => e.Ccy).HasColumnName("ccy");
            entity.Property(e => e.SilmunTotal).HasColumnName("silmun_total").HasColumnType("decimal(18,2)");
            entity.Property(e => e.PaidExpense).HasColumnName("paid_expense").HasColumnType("decimal(18,2)");
            entity.Property(e => e.TotalAdvance).HasColumnName("total_advance").HasColumnType("decimal(18,2)");
            entity.Property(e => e.TotalInvoice).HasColumnName("total_invoice").HasColumnType("decimal(18,2)");
            entity.Property(e => e.Remarks).HasColumnName("remarks").HasMaxLength(500);
            entity.Property(e => e.InsertBy).HasColumnName("insert_by").HasMaxLength(50);
            entity.Property(e => e.InsertTime).HasColumnName("insert_time");
            entity.Property(e => e.UpdateBy).HasColumnName("update_by").HasMaxLength(50);
            entity.Property(e => e.UpdateTime).HasColumnName("update_time");
        });

        // 3. FinalInvoicing -> dbo.final_invoicing
        modelBuilder.Entity<FinalInvoicing>(entity =>
        {
            entity.ToTable("final_invoicing", "dbo");
            entity.HasKey(e => new { e.InvCode, e.MonthYear });
            entity.Property(e => e.InvCode).HasColumnName("inv_code").ValueGeneratedNever();
            entity.Property(e => e.MonthYear).HasColumnName("month_year").HasMaxLength(10);
            entity.Property(e => e.InvoiceTo).HasColumnName("invoice_to");
            entity.Property(e => e.SilmunInvoiceAmt).HasColumnName("silmun_invoice_amt").HasColumnType("decimal(18,2)");
            entity.Property(e => e.PaidInvoiceAmt).HasColumnName("paid_invoice_amt").HasColumnType("decimal(18,2)");
            entity.Property(e => e.AdvancesFundAmt).HasColumnName("advances_fund_amt").HasColumnType("decimal(18,2)");
            entity.Property(e => e.FinalInvoiceAmt).HasColumnName("final_invoice_amt").HasColumnType("decimal(18,2)");
            entity.Property(e => e.InsertBy).HasColumnName("insert_by").HasMaxLength(50);
            entity.Property(e => e.InsertTime).HasColumnName("insert_time");
        });

        // 4. ProfileInvoicing -> dbo.Profile_invoicing
        modelBuilder.Entity<ProfileInvoicing>(entity =>
        {
            entity.ToTable("Profile_invoicing", "dbo");
            entity.HasKey(e => e.CmpProfInvoiceCode);
            entity.Property(e => e.CmpProfInvoiceCode).HasColumnName("cmp_prof_invoice_code").ValueGeneratedNever();
            entity.Property(e => e.EntityCode).HasColumnName("entity_code").HasColumnType("numeric(38,0)");
            entity.Property(e => e.InvoiceTo).HasColumnName("invoice_to");
            entity.Property(e => e.InvoiceMonth).HasColumnName("invoice_month").HasMaxLength(7).IsFixedLength();
            entity.Property(e => e.ChargePercent).HasColumnName("charge_percent").HasColumnType("decimal(5,2)");
            entity.Property(e => e.TotalIncomePkr).HasColumnName("total_income_pkr").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargedAmtPkr).HasColumnName("charged_amt_pkr").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargedAmtUsd).HasColumnName("charged_amt_usd").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ExchangeRateCode).HasColumnName("exchange_rate_code");
            entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.Remarks).HasColumnName("remarks").HasMaxLength(300);
            entity.Property(e => e.InsertBy).HasColumnName("insert_by").HasMaxLength(20);
            entity.Property(e => e.InsertTime).HasColumnName("insert_time");
            entity.Property(e => e.LastModifiedBy).HasColumnName("last_modified_by").HasMaxLength(50);
            entity.Property(e => e.LastModifiedTime).HasColumnName("last_modified_time");
            entity.Property(e => e.PostedDt).HasColumnName("posted_dt");
            entity.Property(e => e.Arrears).HasColumnName("Arrears").HasColumnType("decimal(18,2)");
            entity.Property(e => e.Shortcode).HasColumnName("shortcode").HasMaxLength(30);
            entity.Property(e => e.ShareAmount).HasColumnName("share_amount").HasColumnType("decimal(5,2)");
            entity.Property(e => e.Ccy).HasColumnName("ccy");
            entity.Property(e => e.InvoiceFrom).HasColumnName("invoice_from");
            entity.Property(e => e.PrfownCode).HasColumnName("prfown_code");
            entity.Property(e => e.PrfgrpOwnCode).HasColumnName("prfgrp_own_code");
            entity.Property(e => e.ResourceType).HasColumnName("resource_type").HasMaxLength(2);
            entity.Property(e => e.ProjectCode).HasColumnName("project_code");
            entity.Property(e => e.SecondaryDevCode).HasColumnName("secondary_dev_code");
            entity.Property(e => e.TotalUsdCost).HasColumnName("total_usd_cost");
            entity.Property(e => e.InvoiceNumber).HasColumnName("invoice_number").HasMaxLength(10);
            entity.Property(e => e.ExchangeRate).HasColumnName("exchange_rate").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ChargTypeCode).HasColumnName("charg_type_code");
            entity.Property(e => e.SupportStatus).HasColumnName("support_status").HasMaxLength(2).IsFixedLength();
            entity.Property(e => e.InterviewCode).HasColumnName("interview_code");
            entity.Property(e => e.InterviewSeqCode).HasColumnName("interview_seq_code");
            entity.Property(e => e.MonthDays).HasColumnName("month_days");
            entity.Property(e => e.ProRateDays).HasColumnName("pro_rate_days");
            entity.Property(e => e.IsIncluded).HasColumnName("is_included");
            entity.Property(e => e.ToBeDiscussed).HasColumnName("to_be_discussed").HasDefaultValue(false);
            entity.Property(e => e.DiscussNote).HasColumnName("discuss_note").HasMaxLength(500);
            entity.Property(e => e.DiscussMarkedBy).HasColumnName("discuss_marked_by").HasMaxLength(100);
            entity.Property(e => e.DiscussMarkedTime).HasColumnName("discuss_marked_time");
            entity.Property(e => e.IsProcessed).HasColumnName("is_processed").HasDefaultValue(false);
        });

        // 5. NumberControl -> dbo.NumberControl
        modelBuilder.Entity<NumberControl>(entity =>
        {
            entity.ToTable("NumberControl", "dbo");
            entity.HasKey(e => e.StageName);
            entity.Property(e => e.StageName).HasColumnName("StageName").HasMaxLength(50);
            entity.Property(e => e.LastNo).HasColumnName("LastNo");
        });

        // 6. RizvizUser -> dbo.Rizviz_Users
        modelBuilder.Entity<RizvizUser>(entity =>
        {
            entity.ToTable("Rizviz_Users", "dbo");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("Id").ValueGeneratedOnAdd();
            entity.Property(e => e.Username).HasColumnName("Username").HasMaxLength(100);
            entity.Property(e => e.PasswordHash).HasColumnName("PasswordHash").HasMaxLength(200);
            entity.Property(e => e.PasswordHashV2).HasColumnName("PasswordHashV2").HasMaxLength(256);
            entity.Property(e => e.FullName).HasColumnName("FullName").HasMaxLength(200);
            entity.Property(e => e.Email).HasColumnName("Email").HasMaxLength(200);
            entity.Property(e => e.RoleName).HasColumnName("RoleName").HasMaxLength(50);
            entity.Property(e => e.CompanyCode).HasColumnName("CompanyCode").HasMaxLength(50);
            entity.Property(e => e.BranchCode).HasColumnName("BranchCode").HasMaxLength(50);
            entity.Property(e => e.IsActive).HasColumnName("IsActive");
        });

        // 7. Vendor -> setups.vendors
        modelBuilder.Entity<Vendor>(entity =>
        {
            entity.ToTable("vendors", "setups");
            entity.HasKey(e => e.VendCode);
            entity.Property(e => e.VendCode).HasColumnName("vend_code").ValueGeneratedNever();
            entity.Property(e => e.VendName).HasColumnName("vend_name").HasMaxLength(100);
            entity.Property(e => e.Shortcode).HasColumnName("shortcode").HasMaxLength(30);
            entity.Property(e => e.Active).HasColumnName("active").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.InsertBy).HasColumnName("insert_by").HasMaxLength(20);
            entity.Property(e => e.InsertTime).HasColumnName("insert_time");
            entity.Property(e => e.VendtypeCode).HasColumnName("vendtype_code");
            entity.Property(e => e.AllowEdit).HasColumnName("allow_edit").HasMaxLength(1).IsFixedLength();
        });

        // 8. ExchangeRate -> setups.exchange_rate
        modelBuilder.Entity<ExchangeRate>(entity =>
        {
            entity.ToTable("exchange_rate", "setups");
            entity.HasKey(e => e.ExchangeRateCodeCode);
            entity.Property(e => e.ExchangeRateCodeCode).HasColumnName("ExchangeRateCode_code").ValueGeneratedNever();
            entity.Property(e => e.Rate).HasColumnName("rate").HasColumnType("decimal(18,2)");
            entity.Property(e => e.EffectiveFrom).HasColumnName("effective_from");
            entity.Property(e => e.Active).HasColumnName("active").HasMaxLength(1).IsFixedLength();
        });

        // 9. ProfileOwner -> prof.Profile_Owners
        modelBuilder.Entity<ProfileOwner>(entity =>
        {
            entity.ToTable("Profile_Owners", "prof");
            entity.HasKey(e => e.PrfOwnCode);
            entity.Property(e => e.PrfOwnCode).HasColumnName("PrfOwn_code").ValueGeneratedNever();
            entity.Property(e => e.ProfileName).HasColumnName("profile_name").HasMaxLength(30);
            entity.Property(e => e.IsProfgrpOwner).HasColumnName("is_profgrp_owner").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.IndividualCompany).HasColumnName("individual_company").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.ParentProfileCode).HasColumnName("ParentProfile_code");
            entity.Property(e => e.EmpStatusCode).HasColumnName("EmpStatus_Code");
            entity.Property(e => e.Active).HasColumnName("active").HasMaxLength(1).IsFixedLength();
            entity.Property(e => e.ProfileType).HasColumnName("Profile_type").HasMaxLength(1).IsFixedLength();

            entity.HasOne(e => e.ParentProfile).WithMany(p => p.ChildProfiles).HasForeignKey(e => e.ParentProfileCode);
        });

        // 10. ProfileGrpOwner -> prof.ProfileGRPOwners
        modelBuilder.Entity<ProfileGrpOwner>(entity =>
        {
            entity.ToTable("ProfileGRPOwners", "prof");
            entity.HasKey(e => e.PrfgrpOwnecode);
            entity.Property(e => e.PrfgrpOwnecode).HasColumnName("prfgrp_ownecode").ValueGeneratedNever();
            entity.Property(e => e.PrfOwnCode).HasColumnName("PrfOwn_code");
            entity.Property(e => e.Active).HasColumnName("active").HasMaxLength(1).IsFixedLength();
        });

        // 11. HrmsEntity -> hrms.entity
        modelBuilder.Entity<HrmsEntity>(entity =>
        {
            entity.ToTable("entity", "hrms");
            entity.HasKey(e => e.EntityCode);
            entity.Property(e => e.EntityCode).HasColumnName("entity_code").HasColumnType("numeric(38,0)").ValueGeneratedNever();
            entity.Property(e => e.FullName).HasColumnName("Full_name").HasMaxLength(100);
            entity.Property(e => e.Shortcode).HasColumnName("shortcode").HasMaxLength(30);
        });

        // 12. MktProject -> mkt.Projects
        modelBuilder.Entity<MktProject>(entity =>
        {
            entity.ToTable("Projects", "mkt");
            entity.HasKey(e => e.ProjectCode);
            entity.Property(e => e.ProjectCode).HasColumnName("project_Code").ValueGeneratedNever();
            entity.Property(e => e.ProjName).HasColumnName("Proj_name").HasMaxLength(100);
            entity.Property(e => e.ProjStatus).HasColumnName("proj_status").HasMaxLength(30);
            entity.Property(e => e.InterviewCode).HasColumnName("interview_code");
            entity.Property(e => e.BranchCode).HasColumnName("branch_code");
            entity.Property(e => e.StackCde).HasColumnName("stack_cde");
        });

        // 13. MktProjectInvoicing -> mkt.project_invoicing
        modelBuilder.Entity<MktProjectInvoicing>(entity =>
        {
            entity.ToTable("project_invoicing", "mkt");
            entity.HasKey(e => e.InvoiceSeqCode);
            entity.Property(e => e.InvoiceSeqCode).HasColumnName("invoice_seq_code").ValueGeneratedNever();
            entity.Property(e => e.ProjectCode).HasColumnName("project_code");
            entity.Property(e => e.MonthYear).HasColumnName("month_year").HasMaxLength(7).IsFixedLength();
            entity.Property(e => e.EntityCode).HasColumnName("entity_code").HasColumnType("numeric(38,0)");
            entity.Property(e => e.InvoiceTo).HasColumnName("invoice_to");
            entity.Property(e => e.TotalSalUsd).HasColumnName("total_sal_usd").HasColumnType("decimal(18,2)");
            entity.Property(e => e.RizvizShareDetail).HasColumnName("rizviz_share_detail").HasColumnType("decimal(18,2)");
            entity.Property(e => e.RizvizCharges).HasColumnName("rizviz_charges").HasColumnType("decimal(18,2)");
            entity.Property(e => e.TotalUsdCharges).HasColumnName("Total_USD_Charges").HasColumnType("decimal(18,2)");
            entity.Property(e => e.ResourceType).HasColumnName("resource_type").HasMaxLength(2).IsFixedLength();
        });

        // 14. SetupStack -> setups.stacks
        modelBuilder.Entity<SetupStack>(entity =>
        {
            entity.ToTable("stacks", "setups");
            entity.HasKey(e => e.StackCode);
            entity.Property(e => e.StackCode).HasColumnName("stack_code").ValueGeneratedNever();
            entity.Property(e => e.StackName).HasColumnName("stack_name").HasMaxLength(50);
        });

        // 15. EntityTeamstructure -> hrms.entity_teamstructure
        modelBuilder.Entity<EntityTeamstructure>(entity =>
        {
            entity.ToTable("entity_teamstructure", "hrms");
            entity.HasKey(e => e.EntityCode);
            entity.Property(e => e.EntityCode).HasColumnName("entity_code").HasColumnType("numeric(38,0)").ValueGeneratedNever();
            entity.Property(e => e.TeamstrCode).HasColumnName("teamstr_code").HasColumnType("numeric(38,0)");
            entity.Property(e => e.StackCode).HasColumnName("stack_code");
        });

        // 16. EmpRole -> hrms_setups.Emp_Roles
        modelBuilder.Entity<EmpRole>(entity =>
        {
            entity.ToTable("Emp_Roles", "hrms_setups");
            entity.HasKey(e => e.EmpRolesCode);
            entity.Property(e => e.EmpRolesCode).HasColumnName("Emp_Roles_code").ValueGeneratedNever();
            entity.Property(e => e.ActivityCode).HasColumnName("Activity_code").HasMaxLength(20);
            entity.Property(e => e.Shortcode).HasColumnName("shortcode").HasMaxLength(10);
            entity.Property(e => e.Description).HasColumnName("Description").HasMaxLength(100);
        });

        // 17. UserEmailSettings -> dbo.UserEmailSettings
        modelBuilder.Entity<UserEmailSettings>(entity =>
        {
            entity.ToTable("UserEmailSettings", "dbo");
            entity.HasKey(e => e.UserId);
            entity.Property(e => e.UserId).HasColumnName("UserId").ValueGeneratedNever();
            entity.Property(e => e.SenderEmail).HasColumnName("SenderEmail").HasMaxLength(254).IsRequired();
            entity.Property(e => e.EncryptedAppPassword).HasColumnName("EncryptedAppPassword").IsRequired();
            entity.Property(e => e.SmtpHost).HasColumnName("SmtpHost").HasMaxLength(200);
            entity.Property(e => e.SmtpPort).HasColumnName("SmtpPort");
            entity.Property(e => e.UpdatedAt).HasColumnName("UpdatedAt");
        });
    }
}

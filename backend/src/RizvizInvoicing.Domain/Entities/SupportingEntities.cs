using System;
using System.Collections.Generic;

namespace RizvizInvoicing.Domain.Entities;

public class Vendor
{
    public int VendCode { get; set; }
    public string? VendName { get; set; }
    public string? Shortcode { get; set; }
    public string? Active { get; set; }
    public string? InsertBy { get; set; }
    public DateTime? InsertTime { get; set; }
    public int? VendtypeCode { get; set; }
    public string? AllowEdit { get; set; }
}

public class ExchangeRate
{
    public int ExchangeRateCodeCode { get; set; }
    public decimal? Rate { get; set; }
    public DateTime? EffectiveFrom { get; set; }
    public string? Active { get; set; }
}

public class ProfileOwner
{
    public int PrfOwnCode { get; set; }
    public string? ProfileName { get; set; }
    public string? IsProfgrpOwner { get; set; }
    public string? IndividualCompany { get; set; }
    public int? ParentProfileCode { get; set; }
    public int? EmpStatusCode { get; set; }
    public string? Active { get; set; }
    public string? ProfileType { get; set; }

    public virtual ProfileOwner? ParentProfile { get; set; }
    public virtual ICollection<ProfileOwner> ChildProfiles { get; set; } = new List<ProfileOwner>();
}

public class ProfileGrpOwner
{
    public int PrfgrpOwnecode { get; set; }
    public int? PrfOwnCode { get; set; }
    public string? Active { get; set; }
}

public class HrmsEntity
{
    public decimal EntityCode { get; set; }
    public string? FullName { get; set; }
    public string? Shortcode { get; set; }
}

public class MktProject
{
    public int ProjectCode { get; set; }
    public string? ProjName { get; set; }
    public string? ProjStatus { get; set; }
    public int? InterviewCode { get; set; }
    public int? BranchCode { get; set; }
    public int? StackCde { get; set; }
}

public class MktProjectInvoicing
{
    public int InvoiceSeqCode { get; set; }
    public int? ProjectCode { get; set; }
    public string MonthYear { get; set; } = string.Empty;
    public decimal? EntityCode { get; set; }
    public int? InvoiceTo { get; set; }
    public decimal? TotalSalUsd { get; set; }
    public decimal? RizvizShareDetail { get; set; }
    public decimal? RizvizCharges { get; set; }
    public decimal? TotalUsdCharges { get; set; }
    public string? ResourceType { get; set; }
}

public class SetupStack
{
    public int StackCode { get; set; }
    public string? StackName { get; set; }
}

public class EntityTeamstructure
{
    public decimal EntityCode { get; set; }
    public decimal? TeamstrCode { get; set; }
    public int? StackCode { get; set; }
}

public class EmpRole
{
    public int EmpRolesCode { get; set; }
    public string? ActivityCode { get; set; }
    public string? Shortcode { get; set; }
    public string? Description { get; set; }
}



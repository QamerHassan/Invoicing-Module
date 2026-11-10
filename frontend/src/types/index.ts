/**
 * Data-integrity aligned TypeScript definitions.
 * Sourced directly from OpenAPI / Swagger components.
 * Any contract drift fails compilation at build time.
 */

import type { components } from './api.generated';

export type Schemas = components['schemas'];

// Domain & DTO Types generated from backend OpenAPI contracts
export type CompanyInvoiceDto = Schemas['CompanyInvoiceDto'] & {
  branchCode?: number | null;
  isForeign?: boolean;
  secondaryDevCode?: number | null;
  secondaryDevName?: string | null;
  interviewCode?: number | null;
  interviewSeqCode?: number | null;
  chargTypeCode?: number | null;
  supportStatus?: string | null;
  ccy?: number | null;
  arrears?: number | null;
};
export type DashboardSummaryDto = Omit<Schemas['DashboardSummaryDto'], 'recentInvoices' | 'recentCompanyInvoices'> & {
  recentInvoices?: CompanyInvoiceDto[] | null;
  recentCompanyInvoices?: CompanyInvoiceDto[] | null;
  availableMonths?: string[] | null;
};
export type AdvanceFundDto = Schemas['AdvanceFundDto'];
export type FinalInvoiceDto = Schemas['FinalInvoiceDto'];
export type MonthlyTrendDto = Schemas['MonthlyTrendDto'];
export type TopCompanyDto = Schemas['TopCompanyDto'];
export type TopVendorDto = Schemas['TopCompanyDto'];
export type FinalInvoiceCalculationResult = Schemas['FinalInvoiceCalculationResult'] & {
  isFinalized?: boolean;
  invCode?: number | null;
  insertBy?: string | null;
  insertTime?: string | null;
  advanceFunds?: AdvanceFundDto[] | null;
};
export type CalculateCompanyInvoicesRequest = Schemas['CalculateCompanyInvoicesRequest'];
export type CalculateCompanyInvoicesResponse = Schemas['CalculateCompanyInvoicesResponse'];
export type CreateAdvanceFundRequest = Schemas['CreateAdvanceFundRequest'];
export type AuthResponse = Schemas['AuthResponse'];
export type LoginRequest = Schemas['LoginRequest'];

// Backwards-compatible aliases for UI components
export type CreateAdvanceFundDto = CreateAdvanceFundRequest;
export type CalculateInvoiceRequest = {
  monthYear: string;
  mode?: string;
  profileOwnerId?: number | null;
  replaceExisting: boolean;
};

export type CalculationResultDto = {
  success: boolean;
  message: string;
  recordsProcessed: number;
  deletedExistingCount: number;
  monthYear: string;
};

// Application Auth User State
export interface UserInfo {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  token: string;
}

// Master Lookup Types
export interface VendorDto {
  vendCode: number;
  vendName: string;
  shortcode?: string | null;
}

export interface ProfileOwnerDto {
  prfOwnCode: number;
  profileName: string;
  profileType?: string | null;
  isProfgrpOwner?: string | null;
}

export interface ProfileProjectDto {
  prfownCode: number;
  profileOwner: string;
  projectCode: number;
  projectName: string;
  projStatus: string;
  developerName: string;
  shortcode?: string | null;
}

export interface ExchangeRateDto {
  exchangeRateCode: number;
  rate: number;
  effectiveFrom?: string | null;
}

export interface EntityDto {
  entityCode: number;
  fullName: string;
  shortcode?: string | null;
}

export interface ProjectDto {
  projectCode: number;
  projName: string;
  projStatus?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
}

export interface FinalInvoicePrintDto {
  calculation?: FinalInvoiceCalculationResult;
  summary: FinalInvoiceDto;
  lineItems?: CompanyInvoiceDto[];
  advanceFunds: AdvanceFundDto[];
  generatedAt: string;
}

// Profile Invoicing DTOs
export interface ProfileInvoiceRowDto {
  cmpProfInvoiceCode?: number | null;
  entityCode?: number | null;
  entityName?: string | null;
  invoiceTo: number;
  invoiceToName?: string | null;
  invoiceMonth: string;
  chargePercent?: number | null;
  totalIncomePkr?: number | null;
  chargedAmtPkr?: number | null;
  chargedAmtUsd?: number | null;
  exchangeRateCode?: number | null;
  status?: string | null;
  remarks?: string | null;
  arrears?: number | null;
  shortcode?: string | null;
  shareAmount?: number | null;
  ccy?: number | null;
  invoiceFrom?: number | null;
  prfownCode?: number | null;
  profileOwnerName?: string | null;
  prfgrpOwnCode?: number | null;
  groupOwnerName?: string | null;
  resourceType?: string | null;
  projectCode?: number | null;
  projectName?: string | null;
  stack?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
  secondaryDevCode?: number | null;
  secondaryDevName?: string | null;
  totalUsdCost?: number | null;
  invoiceNumber?: string | null;
  exchangeRate?: number | null;
  chargTypeCode?: number | null;
  supportStatus?: string | null;
  interviewCode?: number | null;
  interviewSeqCode?: number | null;
  monthDays?: number | null;
  proRateDays?: number | null;
  source: string;
  serviceHeadName?: string | null;
  isIncluded?: boolean;
  isExecutive?: boolean;
}

export interface ProfileInvoiceDryRunResult {
  groupOwnerCode: number;
  groupOwnerName: string;
  monthYear: string;
  exchangeRate: number;
  alreadyExists: boolean;
  warningMessage?: string | null;
  childOwnersCount: number;
  ownerCodes: number[];
  countsBySource: Record<string, number>;
  totalUsdSum: number;
  totalPkrSum: number;
  rows: ProfileInvoiceRowDto[];
}

export interface ProfileInvoiceSaveRequest {
  groupOwnerCode: number;
  monthYear: string;
  insertedBy: string;
}

export interface ProfileInvoiceSavedRowDto {
  cmpProfInvoiceCode: number;
  entityCode?: number | null;
  entityName?: string | null;
  prfownCode?: number | null;
  profileOwnerName?: string | null;
  chargTypeCode?: number | null;
  resourceType?: string | null;
  totalIncomePkr?: number | null;
  chargedAmtUsd?: number | null;
  exchangeRate?: number | null;
  source: string;
  isIncluded?: boolean;
  isExecutive?: boolean;
}

export interface ProfileInvoiceSaveResult {
  groupOwnerCode: number;
  groupOwnerName: string;
  monthYear: string;
  success: boolean;
  errorMessage?: string | null;
  rowsInserted: number;
  firstPcomCode: number;
  lastPcomCode: number;
  totalUsdSum: number;
  totalPkrSum: number;
  savedRows: ProfileInvoiceSavedRowDto[];
}

export interface ProfileInvoiceRowUpdateRequest {
  invoiceNumber?: string | null;
  remarks?: string | null;
  status?: string | null;
  totalIncomePkr?: number | null;
  chargedAmtUsd?: number | null;
  chargePercent?: number | null;
  exchangeRate?: number | null;
  arrears?: number | null;
  shareAmount?: number | null;
  isIncluded?: boolean | null;
  totalCost?: number | null;
  agreedRate?: number | null;
  proRateDays?: number | null;
  monthDays?: number | null;
  salaryRate?: string | null;
}

export interface ProfileInvoiceProjectUpdateRequest {
  agreedRate?: number | null;
  proRateDays?: number | null;
  monthDays?: number | null;
  salaryRate?: string | null;
  monthYear: string;
  groupOwnerCode: number;
}

export interface ProfileInvoiceRowUpdateResponse {
  success: boolean;
  message?: string;
  updatedRow?: ProfileInvoiceRowDto;
  totalUsdSum: number;
  totalPkrSum: number;
  excelView?: ProfileInvoiceExcelViewResult;
}

export interface ProfileGroupOwnerDto {
  prfOwnCode: number;
  profileName: string;
  profileType?: string | null;
  isProfgrpOwner?: string | null;
}

export interface ProfileInvoiceExcelViewRowDto {
  cmpProfInvoiceCode?: number | null;
  isIncluded?: boolean;
  isExecutive?: boolean;
  profileOwner?: string | null;
  projectCode?: number | null;
  projectName?: string | null;
  serviceHead?: string | null;
  finalUsd?: number | null;
  totalCost?: number | null;
  agreedRate?: number | null;
  hoursDays?: string | null;
  proDays?: number | null;
  monthDays?: number | null;
  actualCharges?: number | null;
  otherCharge?: number | null;
  salaryRate?: string | null;
  startEndDate?: string | null;
  projStatus?: string | null;
  stack?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
  jobType?: string | null;
  profileNature?: string | null;
  handledFrom?: string | null;
  chargedAmtPkr?: number | null;
  exchangeRate?: number | null;
  shareAmount?: number | null;
  toBeDiscussed?: boolean;
  isToBeDiscussed?: boolean;
  isProcessed?: boolean;
  childInvoiceCodes?: number[];
  rowType: 'StackHeader' | 'ProjectHeader' | 'Detail' | 'Standalone' | 'Blank';
}

export interface ProfileInvoiceExcelViewResult {
  groupOwnerCode: number;
  groupOwnerName: string;
  monthYear: string;
  isFinalized?: boolean;
  totalCostSum: number;
  actualChargesSum: number;
  otherChargeSum: number;
  totalInvoice: number;
  agreedRateSum?: number;
  finalUsdSum?: number;
  totalSavedRows: number;
  totalProjectBlocks: number;
  rows: ProfileInvoiceExcelViewRowDto[];
}

export interface SendProfileInvoiceEmailRequest {
  groupOwnerCode: number;
  month: string;
  replyToEmail?: string;
  toEmail: string;
  subject: string;
  body: string;
  // Multi-sender optional fields
  senderEmail?: string;
  appPassword?: string;
  rememberSettings?: boolean;
  processedOnly?: boolean;
  excludeToBeDiscussed?: boolean;
}

export interface UserEmailSettingsDto {
  senderEmail: string | null;
  hasSavedPassword: boolean;
}

export interface ProfileInvoiceProcessedRowDto {
  cmpProfInvoiceCode: number;
  prfownCode: number;
  profileName: string;
  prfgrpOwnCode: number;
  prfgrpOwnName: string;
  projectCode?: number | null;
  projectName?: string | null;
  stack?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
  invoiceTo: number;
  invoiceToName: string;
  invoiceMonth: string;
  totalIncomePkr: number;
  chargedAmtPkr: number;
  chargedAmtUsd: number;
  ccy?: number | null;
  status?: string | null;
  insertBy?: string | null;
  insertTime?: string | null;
}

export interface ProfileInvoiceUnprocessedRowDto {
  prfownCode: number;
  profileName: string;
  invoiceMonth?: string;
  totalCost: number;
  companyRows?: number;
  interviewRows?: number;
  recurringRows?: number;
  pendingRows: number;
  totalPendingUsd: number;
}

export interface ProfileInvoiceUnprocessedResult {
  monthYear: string;
  totalUnprocessedOwners: number;
  totalCostSum?: number;
  totalPendingRows: number;
  totalPendingUsd: number;
  rows: ProfileInvoiceUnprocessedRowDto[];
}

// Audit log DTO – profile_invoice_audit_log table
export interface ProfileInvoiceAuditLogDto {
  id: number;
  username: string;
  timestamp: string; // ISO datetime
  invoiceMonth: string;
  cmpProfInvoiceCode?: number | null;
  projectCode?: number | null;
  projectName?: string | null;
  stack?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
  fieldName: string;
  oldValue?: string | null;
  newValue?: string | null;
  isMonthFinalized: boolean;
}

// To-Be-Discussed DTO – rows with status='D' or discuss in remarks
export interface ProfileInvoiceDiscussedRowDto {
  cmpProfInvoiceCode: number;
  prfownCode: number;
  profileName: string;
  prfgrpOwnCode: number;
  prfgrpOwnName: string;
  projectCode?: number | null;
  projectName?: string | null;
  stack?: string | null;
  branchCode?: number | null;
  isForeign?: boolean;
  serviceHead?: string | null;
  invoiceMonth: string;
  chargedAmtUsd: number;
  totalCost: number;
  status: string;
  remarks?: string | null;
  isIncluded: boolean;
  invoiceNumber?: string | null;
  toBeDiscussed: boolean;
  discussNote?: string | null;
  discussMarkedBy?: string | null;
  discussMarkedTime?: string | null;
  lastModifiedBy?: string | null;
  lastModifiedTime?: string | null;
}

export interface ProfileInvoiceAddDiscussedRequest {
  codes: number[];
  note?: string;
}

export interface ProfileInvoiceRemoveDiscussedRequest {
  codes: number[];
}

export interface ProfileInvoiceGenerateOpenResult {
  success: boolean;
  message: string;
  groupOwnerCode: number;
  groupOwnerName: string;
  alreadyExisted: boolean;
  rowsGenerated: number;
  excelView?: ProfileInvoiceExcelViewResult | null;
}



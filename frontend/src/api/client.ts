import type { 
  AuthResponse, 
  DashboardSummaryDto, 
  CompanyInvoiceDto, 
  CalculateInvoiceRequest, 
  CalculationResultDto, 
  AdvanceFundDto, 
  CreateAdvanceFundDto, 
  FinalInvoiceDto, 
  FinalInvoiceCalculationResult,
  FinalInvoicePrintDto,
  VendorDto,
  ProfileOwnerDto,
  ProfileProjectDto,
  ExchangeRateDto,
  EntityDto,
  ProjectDto,
  ProfileInvoiceRowDto,
  ProfileInvoiceDryRunResult,
  ProfileInvoiceSaveRequest,
  ProfileInvoiceSaveResult,
  ProfileInvoiceRowUpdateRequest,
  ProfileInvoiceRowUpdateResponse,
  ProfileInvoiceProjectUpdateRequest,
  ProfileGroupOwnerDto,
  ProfileInvoiceExcelViewResult,
  SendProfileInvoiceEmailRequest,
  ProfileInvoiceProcessedRowDto,
  ProfileInvoiceUnprocessedResult,
  ProfileInvoiceGenerateOpenResult,
  UserEmailSettingsDto
} from '../types';

// In production, VITE_API_BASE_URL must be set in Vercel Environment Variables.
// In development, falls back to localhost:5290.
// Update VITE_API_BASE_URL in Vercel dashboard whenever Back4App URL changes.
const BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:5290' : 'https://invoicingmodule-9b3umdsa.back4.app')
).replace(/\/$/, '');

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Retry fetch with exponential backoff for transient network errors and container cold starts
async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      // CloudFront / Back4App returns 502/503/504 while waking container from sleep
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      // Wait 1.5s, then 3s, then 4.5s before retrying
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error('Network request failed after retries');
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    lookupCache.clear();
    window.dispatchEvent(new Event('auth-unauthorized'));
    throw new Error('Session expired or unauthorized. Please log in again.');
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  if (!response.ok) {
    if (isJson) {
      const err = await response.json();
      throw new Error(err.message || err.error || err.errorMessage || err.detail || err.title || 'An error occurred');
    }
    const text = await response.text();
    throw new Error(text || `Error ${response.status}: ${response.statusText}`);
  }

  return (isJson ? await response.json() : null) as T;
}

// Fast client-side cache for static lookups (3-5 min TTL) to make navigation instantaneous
const lookupCache = new Map<string, { data: any; expiry: number }>();

async function getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = lookupCache.get(key);
  if (hit && hit.expiry > Date.now()) {
    return hit.data as T;
  }
  const result = await fetcher();
  lookupCache.set(key, { data: result, expiry: Date.now() + ttlMs });
  return result;
}

export function clearLookupCache(): void {
  lookupCache.clear();
}

export const api = {
  // Auth
  async login(username: string, password: string): Promise<AuthResponse> {
    lookupCache.clear();
    const res = await fetchWithRetry(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    return handleResponse<AuthResponse>(res);
  },

  // Dashboard
  async getDashboard(month?: string): Promise<DashboardSummaryDto> {
    const q = month ? `?month=${encodeURIComponent(month.trim().replace('-', '').toUpperCase())}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/dashboard${q}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<DashboardSummaryDto>(res);
  },

  async getBillingMonths(): Promise<string[]> {
    return getCached('billingMonths', 180000, async () => {
      const res = await fetchWithRetry(`${BASE_URL}/api/dashboard/billing-months`, {
        headers: { ...getAuthHeader() }
      });
      return handleResponse<string[]>(res);
    });
  },

  // Lookups
  async getVendors(): Promise<VendorDto[]> {
    return getCached('vendors', 300000, async () => {
      const res = await fetchWithRetry(`${BASE_URL}/api/lookups/vendors`, {
        headers: { ...getAuthHeader() }
      });
      return handleResponse<VendorDto[]>(res);
    });
  },

  async getProfileOwners(): Promise<ProfileOwnerDto[]> {
    const res = await fetchWithRetry(`${BASE_URL}/api/lookups/profile-owners?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileOwnerDto[]>(res);
  },

  async getExchangeRates(): Promise<ExchangeRateDto[]> {
    return getCached('exchangeRates', 300000, async () => {
      const res = await fetchWithRetry(`${BASE_URL}/api/lookups/exchange-rates`, {
        headers: { ...getAuthHeader() }
      });
      return handleResponse<ExchangeRateDto[]>(res);
    });
  },

  async getEntities(): Promise<EntityDto[]> {
    return getCached('entities', 300000, async () => {
      const res = await fetchWithRetry(`${BASE_URL}/api/lookups/entities`, {
        headers: { ...getAuthHeader() }
      });
      return handleResponse<EntityDto[]>(res);
    });
  },

  async getProjects(): Promise<ProjectDto[]> {
    return getCached('projects', 300000, async () => {
      const res = await fetchWithRetry(`${BASE_URL}/api/lookups/projects`, {
        headers: { ...getAuthHeader() }
      });
      return handleResponse<ProjectDto[]>(res);
    });
  },

  // Company Invoicing
  async getProfileProjects(profileOwnerId?: number): Promise<ProfileProjectDto[]> {
    const query = profileOwnerId ? `?profileOwnerId=${profileOwnerId}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/company-invoices/profile-projects${query}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<ProfileProjectDto[]>(res);
  },

  async getCompanyInvoices(monthYear?: string): Promise<CompanyInvoiceDto[]> {
    const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/company-invoices${query}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<CompanyInvoiceDto[]>(res);
  },

  async calculateInvoices(req: CalculateInvoiceRequest): Promise<CalculationResultDto> {
    const res = await fetchWithRetry(`${BASE_URL}/api/company-invoices/calculate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({
        ...req,
        mode: req.mode || 'Bulk'
      })
    });
    const data = await handleResponse<any>(res);
    return {
      success: true,
      message: `Processed ${data.totalRows ?? 0} rows ($${data.totalChargedUsd ?? 0})`,
      recordsProcessed: data.totalRows ?? 0,
      deletedExistingCount: 0,
      monthYear: data.monthYear ?? req.monthYear
    };
  },

  async postInvoices(monthYear: string): Promise<{ success: boolean; message: string; postedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/company-invoices/post?monthYear=${encodeURIComponent(monthYear)}`, {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string; postedCount: number }>(res);
  },

  async exportCompanyInvoicesExcel(monthYear: string): Promise<Blob> {
    const res = await fetchWithRetry(`${BASE_URL}/api/company-invoices/export-excel?monthYear=${encodeURIComponent(monthYear)}`, {
      headers: { ...getAuthHeader() }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || err?.error || 'Failed to download Company Invoices Excel');
    }
    return res.blob();
  },

  // Advance Funds
  async getAdvanceFunds(monthYear?: string): Promise<AdvanceFundDto[]> {
    const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/advance-funds${query}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<AdvanceFundDto[]>(res);
  },

  async createAdvanceFund(dto: CreateAdvanceFundDto): Promise<AdvanceFundDto> {
    const res = await fetchWithRetry(`${BASE_URL}/api/advance-funds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(dto)
    });
    return handleResponse<AdvanceFundDto>(res);
  },

  async deleteAdvanceFund(invoiceCode: number, monthYear: string): Promise<boolean> {
    const res = await fetchWithRetry(`${BASE_URL}/api/advance-funds/${invoiceCode}?monthYear=${encodeURIComponent(monthYear)}`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<boolean>(res);
  },

  // Final Invoicing
  async getFinalInvoicePreview(monthYear: string): Promise<FinalInvoiceCalculationResult> {
    const res = await fetchWithRetry(`${BASE_URL}/api/final-invoice/preview?monthYear=${encodeURIComponent(monthYear)}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<FinalInvoiceCalculationResult>(res);
  },

  async getFinalInvoice(monthYear: string): Promise<FinalInvoiceDto | null> {
    const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/final-invoice${query}`, {
      headers: { ...getAuthHeader() }
    });
    if (res.status === 404) return null;
    return handleResponse<FinalInvoiceDto | null>(res);
  },

  async getFinalInvoices(monthYear?: string): Promise<FinalInvoiceDto[]> {
    const query = monthYear ? `?monthYear=${encodeURIComponent(monthYear)}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/final-invoice${query}`, {
      headers: { ...getAuthHeader() }
    });
    if (res.status === 404) return [];
    const data = await handleResponse<FinalInvoiceDto | FinalInvoiceDto[] | null>(res);
    if (!data) return [];
    return Array.isArray(data) ? data : [data];
  },

  async saveFinalInvoice(monthYear: string): Promise<FinalInvoiceDto> {
    const res = await fetchWithRetry(`${BASE_URL}/api/final-invoice/save?monthYear=${encodeURIComponent(monthYear)}`, {
      method: 'POST',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<FinalInvoiceDto>(res);
  },

  // PDF & Print
  async downloadFinalInvoicePdf(monthYear: string): Promise<Blob> {
    const res = await fetchWithRetry(`${BASE_URL}/api/pdf/final-invoice?monthYear=${encodeURIComponent(monthYear)}`, {
      headers: { ...getAuthHeader() }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || 'Failed to download PDF');
    }
    return res.blob();
  },

  async getPrintData(monthYear: string): Promise<FinalInvoicePrintDto> {
    const res = await fetchWithRetry(`${BASE_URL}/api/pdf/final-invoice/print-data?monthYear=${encodeURIComponent(monthYear)}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<FinalInvoicePrintDto>(res);
  },

  // Profile Invoicing
  async getProfileGroupOwners(): Promise<ProfileGroupOwnerDto[]> {
    const res = await fetchWithRetry(`${BASE_URL}/api/lookups/profile-group-owners?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileGroupOwnerDto[]>(res);
  },

  async getPostedGroupOwners(month?: string): Promise<ProfileGroupOwnerDto[]> {
    const monthParam = month ? `&month=${encodeURIComponent(month)}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/lookups/posted-group-owners?_t=${Date.now()}${monthParam}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileGroupOwnerDto[]>(res);
  },

  async getProfileInvoiceDryRun(groupOwnerCode: number, month: string): Promise<ProfileInvoiceDryRunResult> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/calculate-dry-run?groupOwnerCode=${groupOwnerCode}&month=${encodeURIComponent(month)}&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileInvoiceDryRunResult>(res);
  },

  async getSavedProfileInvoices(groupOwnerCode: number, monthYear: string): Promise<ProfileInvoiceRowDto[]> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices?groupOwnerCode=${groupOwnerCode}&monthYear=${encodeURIComponent(monthYear)}&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileInvoiceRowDto[]>(res);
  },

  async saveProfileInvoices(request: ProfileInvoiceSaveRequest): Promise<ProfileInvoiceSaveResult> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(request)
    });
    return handleResponse<ProfileInvoiceSaveResult>(res);
  },

  async updateProfileInvoiceRow(cmpProfInvoiceCode: number, request: ProfileInvoiceRowUpdateRequest): Promise<ProfileInvoiceRowUpdateResponse> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/${cmpProfInvoiceCode}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(request)
    });
    return handleResponse<ProfileInvoiceRowUpdateResponse>(res);
  },

  async updateProfileInvoiceProject(projectCode: number, request: ProfileInvoiceProjectUpdateRequest): Promise<ProfileInvoiceRowUpdateResponse> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/project/${projectCode}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(request)
    });
    return handleResponse<ProfileInvoiceRowUpdateResponse>(res);
  },

  async checkProfileMonthFinalized(month: string): Promise<{ month: string; isFinalized: boolean }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/is-finalized?month=${encodeURIComponent(month)}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ month: string; isFinalized: boolean }>(res);
  },

  async getInvoicedMonths(ownerCode?: number): Promise<string[]> {
    const ownerParam = ownerCode && ownerCode > 0 ? `?ownerCode=${ownerCode}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/months${ownerParam}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    return handleResponse<string[]>(res);
  },

  async getProfileInvoiceExcelView(groupOwnerCode: number, month: string): Promise<ProfileInvoiceExcelViewResult> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/excel-view?groupOwnerCode=${groupOwnerCode}&month=${encodeURIComponent(month)}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<ProfileInvoiceExcelViewResult>(res);
  },

  async downloadProfileInvoiceExcel(groupOwnerCode: number, month: string, processedOnly: boolean = false, excludeToBeDiscussed: boolean = false): Promise<Blob> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/excel-download?groupOwnerCode=${groupOwnerCode}&month=${encodeURIComponent(month)}&processedOnly=${processedOnly}&excludeToBeDiscussed=${excludeToBeDiscussed}`, {
      headers: { ...getAuthHeader() }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || 'Failed to download Excel file');
    }
    return res.blob();
  },

  async sendProfileInvoiceEmail(request: SendProfileInvoiceEmailRequest): Promise<{ success: boolean; message: string }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify(request)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async getProcessedInvoices(groupOwnerCode?: number, monthYear: string = 'SEP26'): Promise<ProfileInvoiceProcessedRowDto[]> {
    const encoded = encodeURIComponent(monthYear || 'SEP26');
    const grpParam = groupOwnerCode && groupOwnerCode > 0 ? `&groupOwnerCode=${groupOwnerCode}&ownerCode=${groupOwnerCode}` : '';
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/processed?month=${encoded}&monthYear=${encoded}${grpParam}&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileInvoiceProcessedRowDto[]>(res);
  },

  async getOwnerUnprocessedStatus(ownerCode: number, month: string): Promise<{
    ownerCode: number;
    ownerName: string;
    month: string;
    hasUnprocessed: boolean;
    unprocessedCount: number;
    unprocessedUsd: number;
  }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/owner-unprocessed-status?ownerCode=${ownerCode}&month=${encodeURIComponent(month)}&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse(res);
  },

  async getUnprocessedInvoices(monthYear: string = 'SEP26'): Promise<ProfileInvoiceUnprocessedResult> {
    const encoded = encodeURIComponent(monthYear || 'SEP26');
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/unprocessed?month=${encoded}&monthYear=${encoded}&_t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...getAuthHeader(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    return handleResponse<ProfileInvoiceUnprocessedResult>(res);
  },

  async getSystemDbInfo(): Promise<{ connected: boolean; server?: string; database?: string }> {
    try {
      const res = await fetchWithRetry(`${BASE_URL}/api/system/db-info?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // ignore
    }
    return { connected: false, database: 'Invoicing_System' };
  },

  // Email Settings (per-user saved sender settings)
  async getEmailSettings(): Promise<UserEmailSettingsDto> {
    const res = await fetchWithRetry(`${BASE_URL}/api/email-settings`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<UserEmailSettingsDto>(res);
  },

  async saveEmailSettings(senderEmail: string, appPassword: string): Promise<{ success: boolean; message: string }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/email-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ senderEmail, appPassword })
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async deleteEmailSettings(): Promise<{ success: boolean; message: string }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/email-settings`, {
      method: 'DELETE',
      headers: { ...getAuthHeader() }
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // Audit logs – change history for profile invoices
  async getAuditLogs(month?: string, groupOwnerCode?: number, code?: number): Promise<import('../types').ProfileInvoiceAuditLogDto[]> {
    const params = new URLSearchParams();
    if (month) params.append('month', month);
    if (groupOwnerCode) params.append('groupOwnerCode', String(groupOwnerCode));
    if (code) params.append('code', String(code));
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/audit-logs?${params}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<import('../types').ProfileInvoiceAuditLogDto[]>(res);
  },

  // To-Be-Discussed – rows marked for discussion
  async getToBeDiscussed(month: string, groupOwnerCode?: number): Promise<import('../types').ProfileInvoiceDiscussedRowDto[]> {
    const params = new URLSearchParams({ month });
    if (groupOwnerCode) params.append('groupOwnerCode', String(groupOwnerCode));
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/to-be-discussed?${params}`, {
      headers: { ...getAuthHeader() }
    });
    return handleResponse<import('../types').ProfileInvoiceDiscussedRowDto[]>(res);
  },

  async addToBeDiscussed(codes: number[], note?: string): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/to-be-discussed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ codes, note })
    });
    return handleResponse<{ success: boolean; message: string; updatedCount: number }>(res);
  },

  async removeFromToBeDiscussed(codes: number[]): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/to-be-discussed`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ codes })
    });
    return handleResponse<{ success: boolean; message: string; updatedCount: number }>(res);
  },

  async updateDiscussNote(code: number, note?: string): Promise<{ success: boolean; message: string }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/to-be-discussed/${code}/note`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ note })
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  async processInvoices(codes: number[]): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ codes })
    });
    return handleResponse<{ success: boolean; message: string; updatedCount: number }>(res);
  },

  async unprocessInvoices(codes: number[]): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/process`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ codes })
    });
    return handleResponse<{ success: boolean; message: string; updatedCount: number }>(res);
  },

  async processInvoicesByOwner(prfownCodes: number[], month: string): Promise<{ success: boolean; message: string; updatedCount: number }> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/process-by-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ prfownCodes, month })
    });
    return handleResponse<{ success: boolean; message: string; updatedCount: number }>(res);
  },

  async generateAndOpenProfileInvoices(prfownCode: number, month: string): Promise<ProfileInvoiceGenerateOpenResult> {
    const res = await fetchWithRetry(`${BASE_URL}/api/profile-invoices/generate-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ prfownCode, month })
    });
    return handleResponse<ProfileInvoiceGenerateOpenResult>(res);
  }
};


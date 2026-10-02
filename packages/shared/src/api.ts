import type {
  AuditRow, Customer, Device, DeviceCommand, EnrolmentSession,
  HeartbeatResponse, Payment, Profile, Retailer,
} from './types';

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null>;
}

/**
 * Thin typed client over the emidost API. All routes are role-gated server-side;
 * the client only carries the Supabase session token.
 */
export function createApi({ baseUrl, getToken }: ApiClientOptions) {
  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  return {
    // owner
    listRetailers: () => req<Retailer[]>('/api/owner/retailers'),
    createRetailer: (body: { name: string; phone: string; login_id: string; password: string }) =>
      req<Retailer>('/api/owner/retailers', { method: 'POST', body: JSON.stringify(body) }),
    updateRetailer: (id: string, body: { name?: string; phone?: string; is_suspended?: boolean }) =>
      req<Retailer>(`/api/owner/retailers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    allocateCredits: (retailerId: string, body: { delta: number; kind: 'topup' | 'adjust' }) =>
      req<{ balance_after: number }>(`/api/owner/retailers/${retailerId}/credits`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    setLockAllowances: (retailerId: string, allowances: number) =>
      req<{ lock_allowances: number }>(`/api/owner/retailers/${retailerId}/allowances`, {
        method: 'POST', body: JSON.stringify({ allowances }),
      }),
    listAudit: () => req<AuditRow[]>('/api/owner/audit'),
    issueTotp: (deviceId: string) => req<{ code: string }>(`/api/owner/devices/${deviceId}/totp`, { method: 'POST' }),

    // retailer
    listCustomers: () => req<Customer[]>('/api/retailer/customers'),
    createCustomer: (body: {
      name: string; phone: string; imei: string; brand: string; model: string;
      emi_months: number; emi_amount: number; emi_due_day: number;
    }) => req<Customer>('/api/retailer/customers', { method: 'POST', body: JSON.stringify(body) }),
    recordConsent: (customerId: string, body: { lang: string; otp_ack: boolean; signature_ref?: string }) =>
      req<{ consent_id: string }>(`/api/retailer/customers/${customerId}/consent`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    createEnrolment: (customerId: string, body: { device_serial?: string; apk_sha256?: string }) =>
      req<EnrolmentSession & { token: string }>(`/api/retailer/customers/${customerId}/enrollment`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    getEnrolment: (sessionId: string) => req<EnrolmentSession>(`/api/retailer/enrollments/${sessionId}`),
    listDevices: () => req<Device[]>('/api/retailer/devices'),
    sendCommand: (deviceId: string, commandType: 'LOCK' | 'UNLOCK', payload: Record<string, unknown> = {}) =>
      req<DeviceCommand>(`/api/retailer/devices/${deviceId}/commands`, {
        method: 'POST', body: JSON.stringify({ command_type: commandType, payload }),
      }),
    recordPayment: (customerId: string, body: { amount: number; method: string; receipt_no?: string }) =>
      req<Payment>(`/api/retailer/customers/${customerId}/payments`, {
        method: 'POST', body: JSON.stringify(body),
      }),

    // device (customer app; token = device token, not user session)
    heartbeat: (installationId: string, deviceToken: string, body: Record<string, unknown>) =>
      req<HeartbeatResponse>(`/api/device/heartbeat?installation_id=${encodeURIComponent(installationId)}`, {
        method: 'POST',
        headers: { 'X-Device-Token': deviceToken },
        body: JSON.stringify(body),
      }),
    ackCommand: (installationId: string, deviceToken: string, commandId: string, ackStatus: string, reason?: string) =>
      req<{ ok: boolean }>(`/api/device/command/ack?installation_id=${encodeURIComponent(installationId)}`, {
        method: 'POST',
        headers: { 'X-Device-Token': deviceToken },
        body: JSON.stringify({ command_id: commandId, ack_status: ackStatus, reason }),
      }),
  };
}

export type Api = ReturnType<typeof createApi>;

export function profileRole(profile: Profile | null): 'owner' | 'retailer_staff' | 'customer' | 'none' {
  return profile?.role ?? 'none';
}

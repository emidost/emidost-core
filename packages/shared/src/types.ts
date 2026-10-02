// Shared domain types for emidost. Mirrors supabase/migrations/0001_schema.sql.

export type UserRole = 'owner' | 'retailer_staff' | 'customer';
export type LoanStatus = 'RUNNING' | 'NPA' | 'COMPLETE' | 'SETTLED';
export type EnrolmentState =
  | 'created' | 'prechecked' | 'paired' | 'connected' | 'installed'
  | 'owner_verified' | 'access_verified' | 'finalizing' | 'active' | 'expired';
export type CommandType = 'LOCK' | 'UNLOCK' | 'RELEASE' | 'DEVICE_ACTION' | 'SET_PIN_POLICY' | 'LOCATION';
export type CommandStatus = 'PENDING' | 'RECEIVED' | 'EXECUTED' | 'SUPERSEDED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';
export type DeviceMode = 'none' | 'device_admin' | 'device_owner';
export type LedgerKind = 'topup' | 'slot_consumed' | 'slot_freed' | 'lock_consumed' | 'adjust';

export interface Profile {
  id: string;
  role: UserRole;
  retailer_id: string | null;
  full_name: string | null;
  phone: string | null;
  is_suspended: boolean;
}

export interface Retailer {
  id: string;
  name: string;
  phone: string;
  credits_balance: number;
  lock_allowances: number;
  is_suspended: boolean;
}

export interface Customer {
  id: string;
  retailer_id: string;
  name: string;
  phone: string;
  imei: string;
  brand: string;
  model: string;
  emi_months: number;
  emi_amount: number;
  emi_due_day: number;
  customer_code: string | null;
  status: LoanStatus;
  lock_mode: 'lock' | 'notify_only';
}

export interface Device {
  id: string;
  customer_id: string | null;
  retailer_id: string;
  installation_id: string;
  manufacturer: string | null;
  model: string | null;
  os_version: string | null;
  mode: DeviceMode;
  is_locked: boolean;
  hidden_state: 'visible' | 'hidden';
  last_heartbeat_at: string | null;
}

export interface Payment {
  id: string;
  customer_id: string;
  retailer_id: string;
  amount: number;
  method: string;
  receipt_no: string | null;
  reversed_at: string | null;
  created_at: string;
}

export interface EmiSchedule {
  id: string;
  customer_id: string;
  due_date: string;
  amount_due: number;
  status: 'PENDING' | 'PAID' | 'PARTIAL' | 'OVERDUE';
}

export interface DeviceCommand {
  id: string;
  device_id: string;
  command_type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  created_at: string;
  executed_at: string | null;
}

export interface EnrolmentSession {
  id: string;
  retailer_id: string;
  customer_id: string | null;
  state: EnrolmentState;
  expires_at: string;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  retailer_id: string | null;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}

/** Heartbeat response: commands to execute + fresh device PIN + server_now for the unlock-wins watermark. */
export interface HeartbeatResponse {
  commands: Array<Pick<DeviceCommand, 'id' | 'command_type' | 'payload' | 'created_at'>>;
  device_pin_hash: string | null;
  frp_accounts: string[];
  loan_status: LoanStatus | '';
  retailer_phone: string | null;
  server_now: string;
  policies: Record<string, boolean>;
}

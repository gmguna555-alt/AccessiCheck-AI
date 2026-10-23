export interface UserProfile {
  id: string;
  email: string;
  plan: 'free' | 'pro';
  subscription_status: 'active' | 'inactive' | 'canceled' | 'past_due';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageInfo {
  plan: 'free' | 'pro' | 'unknown';
  remaining: number;
  subscription_status: 'active' | 'inactive' | 'canceled' | 'past_due';
  reason: string;
}

export interface AuditPermission {
  allowed: boolean;
  remaining: number;
  plan: 'free' | 'pro' | 'unknown';
  reason: string;
}

export const FREE_AUDIT_LIMIT = 10;
export const PRO_PRICE_INR = 199;

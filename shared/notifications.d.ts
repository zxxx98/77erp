export const notificationEvents: { key: string; label: string; description: string }[];
export const notificationFormats: { key: string; label: string }[];
export const notificationStatuses: Record<string, string>;
export type NotificationConfig = {
  enabled: boolean; format: string; events: string[]; warehouse_ids: number[];
  include_amounts: boolean; daily_time: string; timezone: string; version: number;
  has_url: boolean; destination: string; has_secret: boolean;
};
export type NotificationLog = {
  id: string; event: string; created_at: string; status: string;
  attempts: number; last_error: string; next_at: number;
};

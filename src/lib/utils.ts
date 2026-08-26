import { v4 as uuidv4 } from "uuid";

/**
 * Generate a unique ID with an optional prefix
 */
export function generateId(prefix: string = ""): string {
  const uuid = uuidv4().split("-")[0];
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/**
 * Convert amount in paise to rupees string (₹2,499)
 */
export function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * Convert rupees to paise
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert paise to rupees
 */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Get cooldown expiry timestamp
 */
export function getCooldownExpiry(minutes?: number): Date {
  const cooldownMinutes = minutes || parseInt(process.env.COOLDOWN_MINUTES || "10");
  const now = new Date();
  return new Date(now.getTime() + cooldownMinutes * 60 * 1000);
}

/**
 * Check if cooldown has expired
 */
export function isCooldownExpired(cooldownUntil: Date | null): boolean {
  if (!cooldownUntil) return true;
  return new Date() >= cooldownUntil;
}

/**
 * Get a readable timestamp
 */
export function getTimestamp(): string {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

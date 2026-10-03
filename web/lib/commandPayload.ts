// Shared payload validation for device commands that carry data in payload.
// Used by both the retailer (commands.ts) and owner (commandProxy.ts) routes so
// a missing or malformed payload is rejected with 400 before the command is
// ever queued. Commands without a payload (LOCK, UNLOCK, GET_SIM, ...) pass.
export function validateCommandPayload(type: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (type === 'SET_DEVICE_PIN') {
    const pin = p.pin;
    if (typeof pin !== 'string' || !/^\d{4,16}$/.test(pin)) {
      return 'SET_DEVICE_PIN requires payload.pin of 4 to 16 digits';
    }
  }
  if (type === 'SET_WALLPAPER') {
    const mode = p.mode;
    if (mode !== 'reminder' && mode !== 'clear') {
      return "SET_WALLPAPER requires payload.mode of 'reminder' or 'clear'";
    }
  }
  return null;
}

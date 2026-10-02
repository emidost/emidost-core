// Stub for modules the bundled server files import but never call on Workers.
// The worker's auth adapter uses bearer tokens, so the cookie jar is empty.
export function cookies() {
  return {
    getAll: () => [] as { name: string; value: string }[],
    set: (..._args: unknown[]) => {},
    delete: (..._args: unknown[]) => {},
  };
}

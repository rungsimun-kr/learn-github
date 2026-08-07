let counter = 0;

/** Short unique id for docs and page items. Only needs to be session-unique. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

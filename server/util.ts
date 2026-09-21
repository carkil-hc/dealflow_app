// Sanitize a company name for use in a generated document filename. Kept as a
// single shared helper so every generator/route produces identical filenames.
export function sanitizeFileBase(name: string): string {
  return name.replace(/[^a-z0-9 _-]/gi, '_');
}

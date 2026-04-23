/**
 * URL helpers with no internal dependencies.
 */

/**
 * Return the URL with query string removed, for safe logging.
 * Returns '<invalid-url>' if parsing fails.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '<invalid-url>';
  }
}

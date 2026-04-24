/**
 * Meta WhatsApp Cloud API error code classification.
 *
 * Some Meta sends return HTTP 200 with an embedded `{"error": {"code": N, ...}}`
 * body. Permanent codes mean Meta will not retry and we should fall back to text.
 * Transient codes mean Meta retries internally; we log but treat the send as
 * successful from the gateway's perspective.
 *
 * Lists pulled from issue #32 against
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 */

const PERMANENT_FAILURE_CODES = new Set<number>([
  130472,
  131008,
  131009,
  131021,
  131026,
  131045,
  131047,
  131048,
  131051,
  131052,
  131053,
  131058,
]);

const TRANSIENT_FAILURE_CODES = new Set<number>([
  130429,
  131000,
  131016,
  131049,
  131056,
  131057,
  133016,
]);

export function isPermanentFailure(code: number): boolean {
  return PERMANENT_FAILURE_CODES.has(code);
}

export function isTransientFailure(code: number): boolean {
  return TRANSIENT_FAILURE_CODES.has(code);
}

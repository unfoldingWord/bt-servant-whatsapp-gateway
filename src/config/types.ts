/**
 * Environment bindings for the Cloudflare Worker.
 *
 * Secrets should be set via `wrangler secret put <NAME>`.
 * Variables are defined in wrangler.toml.
 */
export interface Env {
  // Secrets (set via wrangler secret put)
  META_VERIFY_TOKEN: string;
  META_WHATSAPP_TOKEN: string;
  META_PHONE_NUMBER_ID: string;
  META_APP_SECRET: string;
  ENGINE_API_KEY: string;
  GATEWAY_PUBLIC_URL: string;

  // Variables (from wrangler.toml)
  ENVIRONMENT: string;
  ENGINE_BASE_URL: string;
  ENGINE_ORG: string;
  CHUNK_SIZE: string;
  MESSAGE_AGE_CUTOFF_SECONDS: string;
  PROGRESS_THROTTLE_SECONDS: string;
  FACEBOOK_USER_AGENT: string;
}

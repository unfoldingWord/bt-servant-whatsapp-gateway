import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'test',
            META_VERIFY_TOKEN: 'test-verify-token',
            META_WHATSAPP_TOKEN: 'test-whatsapp-token',
            META_PHONE_NUMBER_ID: '123456789',
            META_APP_SECRET: 'test-app-secret',
            ENGINE_API_KEY: 'test-engine-key',
            ENGINE_BASE_URL: 'http://localhost:8787',
            ENGINE_ORG: 'test-org',
            CHUNK_SIZE: '1500',
            MESSAGE_AGE_CUTOFF_SECONDS: '3600',
            PROGRESS_THROTTLE_SECONDS: '3.0',
            FACEBOOK_USER_AGENT: 'facebookexternalua',
            GATEWAY_PUBLIC_URL: 'https://gateway.example.com',
          },
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});

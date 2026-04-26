import type { JWTPayload } from "@mining/auth";

export type Env = {
  DB:           D1Database;
  SESSIONS:     KVNamespace;
  RATE_LIMIT:   KVNamespace;
  CACHE:        KVNamespace;
  AI_QUEUE:     Queue;

  // Secrets (wrangler secret put)
  JWT_SECRET:                          string;
  TOTP_ISSUER:                         string;
  ANTHROPIC_API_KEY:                   string;
  MTN_MOMO_SUBSCRIPTION_KEY_COLLECTION:    string;
  MTN_MOMO_SUBSCRIPTION_KEY_DISBURSEMENT:  string;
  MTN_MOMO_API_USER:                   string;
  MTN_MOMO_API_KEY:                    string;
  MTN_MOMO_ENV:                        string;   // "sandbox" | "production"
  PAYSTACK_SECRET_KEY:                 string;
  PLATFORM_FEE_PCT:                    string;   // "10" = 10%
  WEBHOOK_SECRET_PAYSTACK:             string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user:       JWTPayload;
    requestId:  string;
  };
};

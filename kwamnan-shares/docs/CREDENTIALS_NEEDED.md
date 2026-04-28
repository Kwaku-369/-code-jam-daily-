# 🔑 What YOU Need to Provide — Kwamnan Shares App

This document lists every account, credential, and ID that only you as the
bank owner can obtain. The app is fully built — you just need to plug in these keys.

---

## 1. SUPABASE (Free — Database + Auth + Storage)

**Time to get:** 5 minutes  
**Cost:** Free (generous limits for this use case)

### Steps:
1. Go to https://supabase.com and click "Start your project"
2. Create a new project: name it `kwamnan-shares`, choose a strong database password, pick the **West Africa** or **Europe** region
3. Once created, go to **Settings → API**
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (SECRET - never expose) → `SUPABASE_SERVICE_ROLE_KEY`
5. Go to **Storage** → Create bucket named `certificates` (set to **private**)
6. Go to **SQL Editor** → Run migration files in order:
   - `database/migrations/001_initial.sql`
   - `database/migrations/002_shares_transactions.sql`
   - `database/migrations/003_security_audit.sql`
   - `database/migrations/004_rls_policies.sql`

---

## 2. PAYSTACK (Payment Processing — Cards + Mobile Money)

**Time to get:** 2-3 days (business verification required)  
**Cost:** 1.95% per transaction (capped at GHS 100), no monthly fees  
**Handles:** Visa, Mastercard, MTN MoMo, Vodafone Cash, AirtelTigo

### Steps:
1. Go to https://paystack.com/gh (Ghana)
2. Register with Kwamnan Rural Bank's business details:
   - Business name: Kwamnan Rural Bank Limited
   - Business type: Licensed Financial Institution
   - Registration number: (your BoG license / company reg number)
   - Bank account for settlements
3. Complete KYC (business registration certificate, BoG license)
4. Once approved, go to **Settings → API Keys & Webhooks**
5. Copy:
   - **Test Secret Key** (for development): `sk_test_...`
   - **Live Secret Key** (for production): `sk_live_...`
   - **Public Key**: `pk_live_...` → `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
6. Set webhook URL to: `https://kwamnan-shares-api.YOUR_SUBDOMAIN.workers.dev/api/webhooks/paystack`
7. Enable events: `charge.success`, `transfer.success`, `charge.failed`

### ⚠️ MTN Direct API (Optional — Use Paystack first)
Paystack already handles MTN MoMo through their platform. The direct MTN MoMo API
requires a separate 4-6 week application process. Start with Paystack.

If you later need direct MTN integration:
- Apply at https://momodeveloper.mtn.com
- Requires: business registration in Ghana, MTN business agreement
- Contact: Ghana MTN business team

---

## 3. CLOUDFLARE (Deployment — Free)

**Time to get:** 15 minutes  
**Cost:** Free (Pages + Workers free tiers are more than sufficient)

### Steps:
1. Go to https://cloudflare.com and create an account
2. Create **API Token** (Settings → API Tokens → Create Token → Edit Cloudflare Workers)
3. Note your **Account ID** from the dashboard right sidebar
4. For custom domain (optional): Add your domain to Cloudflare

### Cloudflare KV Namespaces (for rate limiting):
```bash
# Install Wrangler CLI first
npm install -g wrangler
wrangler login

# Create KV namespaces
wrangler kv:namespace create "RATE_LIMIT_KV"
wrangler kv:namespace create "RATE_LIMIT_KV" --preview
wrangler kv:namespace create "SESSION_KV"
wrangler kv:namespace create "SESSION_KV" --preview
```
Copy the IDs into `apps/worker/wrangler.toml`

---

## 4. GOOGLE AUTHENTICATOR (TOTP — Built into Supabase)

**No account needed** — Supabase handles TOTP enrollment automatically.

For bank staff (admin accounts):
- After creating admin accounts, direct staff to `/verify-2fa` to set up Google Authenticator
- They download the free Google Authenticator app (iOS/Android)
- Scan QR code shown on screen

---

## 5. RAILWAY (AI Security Agent — Free Tier)

**Time to get:** 5 minutes  
**Cost:** Free ($5/month credit, sufficient for the security agent)

### Steps:
1. Go to https://railway.app and sign in with GitHub
2. Create new project → Deploy from GitHub → select this repo
3. Set **root directory** to `packages/security-agent`
4. Add environment variables:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_KEY` = your service role key
5. Railway auto-detects Dockerfile and deploys

---

## 6. DOMAIN NAME (Optional but Recommended)

**Cost:** ~$10-15/year  
**Recommendation:** Register at Cloudflare Registrar (cheapest at cost price)

Suggested domain names:
- kwamnanshares.com.gh
- kwamnanruralbankshares.com
- kwamnaninvest.com.gh

---

## 7. EMAIL SERVICE (for notifications — Optional)

For production email notifications, add one of these:

### Option A: Resend (Recommended — Free 3,000 emails/month)
1. Sign up at https://resend.com
2. Add DNS records to verify your domain
3. Get API key → add as `RESEND_API_KEY` env var

### Option B: SendGrid (Free 100/day)
1. Sign up at https://sendgrid.com

---

## SUMMARY CHECKLIST

| Item | Required? | Time | Cost |
|------|-----------|------|------|
| Supabase account | ✅ YES | 5 min | Free |
| Paystack business account | ✅ YES | 2-3 days | Per transaction |
| Cloudflare account | ✅ YES | 15 min | Free |
| Railway account (security agent) | ✅ YES | 5 min | Free |
| Domain name | Recommended | 10 min | ~$15/yr |
| Email service | Recommended | 10 min | Free |
| MTN MoMo direct API | Optional | 4-6 weeks | Contact MTN |

---

## IMPORTANT SECURITY NOTES

1. **Never share** your `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` — these give full access
2. **Store secrets** only in Cloudflare Worker secrets (via `wrangler secret put`), never in code
3. **Test first** with Paystack TEST keys (prefix `sk_test_`) before going live with `sk_live_`
4. **BoG Compliance**: Ensure your Paystack business account is verified with your Bank of Ghana license
5. **Backups**: Enable Supabase daily backups (Settings → Backups)

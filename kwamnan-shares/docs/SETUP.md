# 🚀 Complete Setup & Deployment Guide

## Prerequisites
- Node.js 20+
- Python 3.11+ (for security agent)
- Git
- npm or yarn

---

## Step 1: Clone & Install

```bash
git clone https://github.com/YOUR_GITHUB/kwamnan-shares.git
cd kwamnan-shares
npm install
```

---

## Step 2: Configure Supabase

1. Complete steps in `CREDENTIALS_NEEDED.md` → Section 1 (Supabase)
2. Copy `.env.example` files:
```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env.local
```
3. Fill in your Supabase values in both `.env.local` files

---

## Step 3: Run Database Migrations

In your Supabase dashboard → SQL Editor, run these files **in order**:
1. `database/migrations/001_initial.sql`
2. `database/migrations/002_shares_transactions.sql`
3. `database/migrations/003_security_audit.sql`
4. `database/migrations/004_rls_policies.sql`

---

## Step 4: Create First Admin Account

After migrations, in Supabase SQL Editor run:
```sql
-- After you register an account via the app, promote it to admin
UPDATE profiles
SET role = 'admin', status = 'active'
WHERE email = 'your-admin-email@kwamnanbank.com';
```

---

## Step 5: Deploy Cloudflare Worker (API)

```bash
cd apps/worker
npm install

# Set secrets (run each one, enter value when prompted)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put PAYSTACK_SECRET_KEY
wrangler secret put PAYSTACK_PUBLIC_KEY
wrangler secret put JWT_SECRET
wrangler secret put WEBHOOK_SECRET

# Deploy
wrangler deploy
```

Note the Worker URL — it will be like: `https://kwamnan-shares-api.YOUR_ACCOUNT.workers.dev`

---

## Step 6: Deploy Frontend to Cloudflare Pages

```bash
cd apps/web

# Set environment variables in Cloudflare Pages dashboard, then:
npm run build

# Deploy (or connect via Cloudflare Pages GitHub integration for auto-deploy)
npx wrangler pages deploy .next --project-name kwamnan-shares
```

In Cloudflare Pages dashboard, add environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL` = your Worker URL from Step 5
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`

---

## Step 7: Deploy Security Agent (Railway)

```bash
cd packages/security-agent
# Push to GitHub, then connect Railway to your repo
# Set env vars in Railway:
# SUPABASE_URL=...
# SUPABASE_SERVICE_KEY=...
```

---

## Step 8: Set Paystack Webhook

In Paystack dashboard → Settings → API Keys & Webhooks:
- Webhook URL: `https://kwamnan-shares-api.YOUR_ACCOUNT.workers.dev/api/webhooks/paystack`
- Enable: `charge.success`, `charge.failed`, `transfer.success`

---

## Step 9: Set Up Admin TOTP

1. Create admin staff accounts via the app registration
2. Promote to admin in Supabase (Step 4 SQL)
3. Have each staff member go to `/verify-2fa` and set up Google Authenticator
4. **All approval actions require a valid TOTP code** — this is mandatory

---

## Step 10: Test Checklist

- [ ] Register a test investor account
- [ ] Login and verify dashboard loads
- [ ] Set up Google Authenticator
- [ ] Initiate a test share purchase (use Paystack test keys first!)
- [ ] Test payment via Paystack test card: `4084084084084081`, any CVV, future expiry
- [ ] Test MoMo: use Paystack sandbox with test number
- [ ] Log in as admin, check approval queue appears
- [ ] Approve transaction (use TOTP code)
- [ ] Verify certificate is generated
- [ ] Download certificate PDF

---

## Local Development

```bash
# Terminal 1: Frontend
cd apps/web && npm run dev

# Terminal 2: Worker API
cd apps/worker && wrangler dev

# Terminal 3: Security Agent (optional)
cd packages/security-agent
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

---

## Architecture Overview

```
User Browser
    │
    ▼
Cloudflare Pages (Next.js frontend)
    │
    ▼
Cloudflare Workers (Hono.js API)
    │
    ├──► Supabase (PostgreSQL + Auth + Realtime + Storage)
    │         ├── Share transactions
    │         ├── User profiles
    │         ├── Certificates (PDFs in Storage)
    │         └── Real-time notifications
    │
    ├──► Paystack API
    │         ├── Card payments (Visa/Mastercard)
    │         └── Mobile Money (MTN/Vodafone/AirtelTigo)
    │
    └──► Railway (Python Security Agent)
              ├── Threat detection (runs every 60s)
              ├── ML anomaly detection (runs every 5min)
              └── Duplicate account scanning (runs every 6h)
```

---

## Common Issues & Fixes

**Issue:** "CORS error" when calling the Worker API
**Fix:** Add your frontend URL to `FRONTEND_URL` in worker env vars

**Issue:** "JWT expired" errors
**Fix:** Supabase tokens expire after 1 hour — the frontend auto-refreshes, ensure refresh_token is stored in sessionStorage

**Issue:** Certificates not generating
**Fix:** Check that the `certificates` bucket exists in Supabase Storage and RLS policies are applied

**Issue:** TOTP codes failing
**Fix:** Ensure your phone/computer clock is synchronized (TOTP is time-based). Check NTP sync.

**Issue:** Paystack webhook not firing
**Fix:** Verify the webhook URL is correct and Cloudflare isn't blocking it; check Worker logs via `wrangler tail`

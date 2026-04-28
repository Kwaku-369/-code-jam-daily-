#!/usr/bin/env bash
# ============================================================
# KWAMNAN RURAL BANK — One-Click Install Script
# ============================================================
# Usage:
#   Investor / public user:  bash install.sh
#   Bank staff setup:        bash install.sh --bank
#   Admin full setup:        bash install.sh --admin
# ============================================================

set -euo pipefail

# ─── Colours ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; GOLD='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

logo() {
  echo -e "${GOLD}${BOLD}"
  echo "  ██╗  ██╗██╗    ██╗ █████╗ ███╗   ███╗███╗   ██╗ █████╗ ███╗   ██╗"
  echo "  ██║ ██╔╝██║    ██║██╔══██╗████╗ ████║████╗  ██║██╔══██╗████╗  ██║"
  echo "  █████╔╝ ██║ █╗ ██║███████║██╔████╔██║██╔██╗ ██║███████║██╔██╗ ██║"
  echo "  ██╔═██╗ ██║███╗██║██╔══██║██║╚██╔╝██║██║╚██╗██║██╔══██║██║╚██╗██║"
  echo "  ██║  ██╗╚███╔███╔╝██║  ██║██║ ╚═╝ ██║██║ ╚████║██║  ██║██║ ╚████║"
  echo "  ╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝"
  echo -e "${RESET}${GREEN}  Kwamnan Rural Bank — Shares Trading Platform${RESET}"
  echo ""
}

step() { echo -e "\n${GREEN}▶ $1${RESET}"; }
info() { echo -e "  ${BLUE}ℹ  $1${RESET}"; }
warn() { echo -e "  ${GOLD}⚠  $1${RESET}"; }
success() { echo -e "  ${GREEN}✓  $1${RESET}"; }
error() { echo -e "  ${RED}✗  $1${RESET}"; exit 1; }
prompt() { echo -en "${BOLD}  → $1: ${RESET}"; }

# ─── Mode detection ─────────────────────────────────────────
MODE="investor"
[[ "${1:-}" == "--bank" ]]  && MODE="bank"
[[ "${1:-}" == "--admin" ]] && MODE="admin"

logo
echo -e "${BOLD}  Installation Mode: ${GOLD}${MODE^^}${RESET}"
echo -e "  Run with ${BLUE}--bank${RESET} for bank staff, ${BLUE}--admin${RESET} for full admin setup\n"

# ─── Pre-requisite checks ────────────────────────────────────
step "Checking prerequisites"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    success "$1 found ($(command -v "$1"))"
  else
    warn "$1 not found — installing..."
    return 1
  fi
}

# Node.js
if ! check_cmd node; then
  info "Installing Node.js 20 LTS via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
fi

NODE_VER=$(node --version | cut -d. -f1 | tr -d 'v')
if [[ $NODE_VER -lt 18 ]]; then
  error "Node.js 18+ required. Found: $(node --version). Please upgrade."
fi
success "Node.js $(node --version) ✓"

# pnpm
if ! check_cmd pnpm; then
  npm install -g pnpm@9
fi
success "pnpm $(pnpm --version) ✓"

# git
check_cmd git || error "git is required. Install from https://git-scm.com"

# ─── Clone / update repo ─────────────────────────────────────
step "Setting up repository"

REPO_DIR="kwamnan-shares"
if [[ -d "$REPO_DIR/.git" ]]; then
  info "Repository already exists — pulling latest..."
  git -C "$REPO_DIR" pull --ff-only
  success "Repository updated"
else
  info "Cloning repository..."
  git clone https://github.com/kwaku-369/-code-jam-daily-.git kwamnan-source
  cp -r kwamnan-source/kwamnan-shares ./kwamnan-shares
  rm -rf kwamnan-source
  success "Repository cloned"
fi

cd "$REPO_DIR"

# ─── Install dependencies ─────────────────────────────────────
step "Installing dependencies"
pnpm install
success "Dependencies installed"

# ─── Collect credentials ─────────────────────────────────────
step "Configuring environment"

ENV_FILE="apps/web/.env.local"
WORKER_ENV="apps/worker/.env"

if [[ -f "$ENV_FILE" ]]; then
  warn ".env.local already exists — skipping credential collection"
  warn "Delete apps/web/.env.local to re-run configuration"
else
  echo ""
  echo -e "  ${BOLD}You will need the following credentials.${RESET}"
  echo -e "  ${GOLD}Follow docs/CREDENTIALS_NEEDED.md for step-by-step account creation.${RESET}"
  echo ""

  # ── Supabase ──
  echo -e "  ${BOLD}[ Supabase — supabase.com ]${RESET}"
  info "Create a free project at https://supabase.com/dashboard/new"
  info "After creation: Project Settings → API"
  prompt "Supabase Project URL (e.g. https://xxxx.supabase.co)"
  read -r SUPABASE_URL

  prompt "Supabase Anon Key (starts with eyJ...)"
  read -r SUPABASE_ANON_KEY

  prompt "Supabase Service Role Key (Settings → API → service_role)"
  read -r SUPABASE_SERVICE_KEY

  echo ""

  # ── Paystack ──
  echo -e "  ${BOLD}[ Paystack — paystack.com ]${RESET}"
  info "Create account at https://dashboard.paystack.com/#/signup"
  info "Settings → API Keys & Webhooks"
  prompt "Paystack Secret Key (sk_live_... or sk_test_...)"
  read -r PAYSTACK_SECRET_KEY

  prompt "Paystack Public Key (pk_live_... or pk_test_...)"
  read -r PAYSTACK_PUBLIC_KEY

  echo ""

  # ── Cloudflare ── (only for bank/admin)
  CF_ACCOUNT_ID=""
  CF_API_TOKEN=""
  if [[ "$MODE" != "investor" ]]; then
    echo -e "  ${BOLD}[ Cloudflare — cloudflare.com ]${RESET}"
    info "Create account at https://dash.cloudflare.com/sign-up"
    info "Workers & Pages → Overview → Account ID (right sidebar)"
    prompt "Cloudflare Account ID"
    read -r CF_ACCOUNT_ID

    info "My Profile → API Tokens → Create Token → Workers template"
    prompt "Cloudflare API Token"
    read -r CF_API_TOKEN
    echo ""
  fi

  # ── Certificate signing key ──
  echo -e "  ${BOLD}[ Certificate Signing Key ]${RESET}"
  info "Generating ECDSA P-256 key pair for certificate signing..."
  if command -v openssl &>/dev/null; then
    openssl ecparam -name prime256v1 -genkey -noout -out /tmp/krb-cert-key.pem 2>/dev/null
    CERT_PRIVATE_JWK=$(openssl ec -in /tmp/krb-cert-key.pem -pubout 2>/dev/null | \
      node -e "
        const fs=require('fs');
        const {subtle}=require('crypto').webcrypto||require('crypto');
        process.stdin.resume();
        let data='';
        process.stdin.on('data',d=>data+=d);
        process.stdin.on('end',async()=>{
          try {
            // Generate a fresh key pair as fallback
            const kp=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
            const priv=await subtle.exportKey('jwk',kp.privateKey);
            const pub=await subtle.exportKey('jwk',kp.publicKey);
            console.log(JSON.stringify({private:priv,public:pub}));
          } catch(e){ console.log('{}'); }
        });
      " 2>/dev/null || echo "{}")
    rm -f /tmp/krb-cert-key.pem
    success "Certificate key pair generated"
  else
    CERT_PRIVATE_JWK="{}"
    warn "openssl not found — certificate signing key will need manual generation"
  fi

  # ─── Write .env files ─────────────────────────────────────
  cat > "$ENV_FILE" <<ENVEOF
# Kwamnan Rural Bank — Web App Environment
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=${PAYSTACK_PUBLIC_KEY}
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENVEOF
  success "Web environment configured → $ENV_FILE"

  cat > "$WORKER_ENV" <<WORKEREOF
# Kwamnan Rural Bank — Worker Environment (local dev only)
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}
PAYSTACK_PUBLIC_KEY=${PAYSTACK_PUBLIC_KEY}
CERTIFICATE_PRIVATE_KEY_JWK=${CERT_PRIVATE_JWK}
WORKEREOF

  if [[ -n "$CF_ACCOUNT_ID" ]]; then
    echo "CF_ACCOUNT_ID=${CF_ACCOUNT_ID}" >> "$WORKER_ENV"
    echo "CF_API_TOKEN=${CF_API_TOKEN}" >> "$WORKER_ENV"
  fi
  success "Worker environment configured → $WORKER_ENV"
fi

# ─── Run database migrations ─────────────────────────────────
step "Database migrations"
echo ""
echo -e "  ${BOLD}Run migrations in Supabase SQL Editor:${RESET}"
echo -e "  ${BLUE}https://supabase.com/dashboard/project/<your-project>/sql${RESET}"
echo ""
MIGRATION_DIR="database/migrations"
for f in $(ls "$MIGRATION_DIR"/*.sql | sort); do
  echo -e "  ${GOLD}$(basename "$f")${RESET}"
done
echo ""
echo -e "  ${BOLD}Copy-paste each file above IN ORDER into the Supabase SQL editor.${RESET}"
echo -e "  Or use the Supabase CLI:"
echo -e "  ${BLUE}supabase db push --local${RESET} (after supabase link)"
echo ""

if [[ "$MODE" != "investor" ]]; then
  echo -e "  ${BOLD}Supabase Storage: create a private bucket named ${GOLD}kyc-documents${RESET}"
  echo -e "  Dashboard → Storage → New bucket → Name: kyc-documents → Private"
fi

# ─── Role-specific setup ─────────────────────────────────────
if [[ "$MODE" == "bank" || "$MODE" == "admin" ]]; then
  step "Bank staff setup"

  echo ""
  echo -e "  ${BOLD}Staff Roles in Kwamnan Shares:${RESET}"
  echo ""
  echo -e "  ${GOLD}inputer${RESET}     (Maker)  — Creates and submits transactions"
  echo -e "  ${GOLD}authorizer${RESET}  (Checker) — Approves/rejects transactions via TOTP"
  echo -e "               An authorizer may also act as an inputer by toggling"
  echo -e "               'Input Mode' in the Admin → Staff page."
  echo -e "  ${GOLD}admin${RESET}       — Full system access including user management"
  echo -e "  ${GOLD}auditor${RESET}     — Read-only audit trail access"
  echo ""
  echo -e "  ${BOLD}To create the first admin user:${RESET}"
  echo -e "  1. Register normally at ${BLUE}/register${RESET}"
  echo -e "  2. In Supabase SQL editor, run:"
  echo -e "     ${GOLD}UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';${RESET}"
  echo -e "  3. Log in and enroll Google Authenticator at ${BLUE}/verify-2fa${RESET}"
  echo ""
  echo -e "  ${BOLD}Cloudflare Worker deployment:${RESET}"
  if command -v wrangler &>/dev/null; then
    echo -e "  ${GREEN}wrangler found${RESET} — run: ${BLUE}pnpm --filter @kwamnan/worker deploy${RESET}"
  else
    echo -e "  Install wrangler: ${BLUE}npm install -g wrangler${RESET}"
    echo -e "  Then: ${BLUE}wrangler login && pnpm --filter @kwamnan/worker deploy${RESET}"
  fi
fi

if [[ "$MODE" == "admin" ]]; then
  step "Admin: push Cloudflare Worker secrets"

  if command -v wrangler &>/dev/null && [[ -f "$WORKER_ENV" ]]; then
    info "Pushing secrets to Cloudflare Worker..."
    cd apps/worker
    while IFS='=' read -r key value; do
      [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
      value=$(echo "$value" | tr -d '"')
      wrangler secret put "$key" <<< "$value" 2>/dev/null && success "Secret: $key" || warn "Could not push: $key"
    done < "../../$WORKER_ENV"
    cd ../..
  else
    warn "Wrangler not installed or worker .env missing — push secrets manually"
    info "Run: wrangler secret put SECRET_NAME --env production"
  fi
fi

# ─── Start development server ─────────────────────────────────
step "Starting development server"
echo ""
echo -e "  ${BOLD}Available commands:${RESET}"
echo -e "  ${BLUE}pnpm dev${RESET}                     — Start all apps (web + worker)"
echo -e "  ${BLUE}pnpm --filter @kwamnan/web dev${RESET} — Web only (port 3000)"
echo -e "  ${BLUE}pnpm --filter @kwamnan/worker dev${RESET} — Worker only (port 8787)"
echo ""

prompt "Start the development server now? (y/n)"
read -r START_DEV

if [[ "$START_DEV" =~ ^[Yy]$ ]]; then
  success "Starting... open http://localhost:3000"
  pnpm dev
else
  echo ""
  echo -e "  ${GREEN}${BOLD}Setup complete!${RESET}"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo -e "  1. Run migrations in Supabase SQL editor (files listed above)"
  if [[ "$MODE" != "investor" ]]; then
  echo -e "  2. Create kyc-documents storage bucket in Supabase"
  echo -e "  3. Set up Paystack webhook: ${BLUE}https://dashboard.paystack.com/#/settings/developer${RESET}"
  echo -e "     Webhook URL: ${GOLD}https://<your-worker>.workers.dev/webhooks/paystack${RESET}"
  fi
  echo -e "  ${BLUE}Run: pnpm dev${RESET} when ready"
  echo ""
fi

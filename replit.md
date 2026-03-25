# OcholaSupernet — ISP & Hotspot Management Platform

## Overview
A full-stack multi-tenant ISP and hotspot management platform for Kenyan ISPs. Includes Super Admin dashboard, ISP Admin portal, Hotspot login portal, and PPPoE client portal. Built as a dark-themed, professional-grade SaaS platform.

## Architecture

### Frontend (`artifacts/ochola-supernet/`)
- **Framework**: React + Vite + TypeScript
- **Routing**: Wouter
- **Styling**: Tailwind CSS v4
- **Charts**: Recharts
- **Animations**: Framer Motion
- **UI**: Shadcn/ui components
- **Port**: 21955 (dev), served at `/`

### Backend (`artifacts/api-server/`)
- **Framework**: Express 5 + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Logging**: Pino + pino-http
- **Port**: 8080, mounted at `/api`

### Database (`lib/db/`)
- **ORM**: Drizzle ORM
- **Schema**: `lib/db/src/schema/`
  - `isps.ts` — ISP tenants
  - `customers.ts` — Customer accounts (PPPoE + hotspot)
  - `plans.ts` — Internet plans (hotspot + PPPoE)
  - `vouchers.ts` — Hotspot vouchers
  - `transactions.ts` — Payment transactions (M-Pesa, cash)
  - `routers.ts` — MikroTik router registry

### API Spec (`lib/api-spec/`)
- OpenAPI 3.0 spec in `openapi.yaml`
- Generated client: `lib/api-client-react/`
- Generated Zod schemas: `lib/api-zod/`

## Pages & Routes

| Route | Page |
|-------|------|
| `/` | Landing / Marketing Page |
| `/admin/login` | ISP Admin Login |
| `/admin/dashboard` | ISP Admin Dashboard |
| `/admin/customers` | Customer Management |
| `/admin/plans` | Plans/Packages |
| `/admin/transactions` | Transactions |
| `/admin/network` | Network (Routers, PPPoE, Queues, IP Pool) |
| `/super-admin/dashboard` | Platform Super Admin |
| `/hotspot-login` | Hotspot Portal (Buy plan, Login, Redeem voucher) |
| `/isp-register` | ISP Registration (stub) |
| `/pppoe-login` | PPPoE Client Portal (stub) |

## Design System
- **Background**: `#080c10` / `#0d1117` (dark navy)
- **Surface**: `#111820` / `#161b22`
- **Sidebar**: `#0f1923`
- **ISP Admin accent**: Cyan `#06b6d4`
- **Super Admin accent**: Indigo/violet `#6366f1`
- **Hotspot portal accent**: Purple `#c026d3`
- **Text**: White headings, `#94a3b8` body, `#475569` muted
- **Borders**: `rgba(255,255,255,0.06)` — `rgba(255,255,255,0.12)`
- **Font**: Inter

## Demo Data
Pre-seeded via `artifacts/api-server/src/seed.ts`:
- 1 ISP: OcholaNet ISP
- 10 Customers (John Kamau, Mary Wanjiku, etc.)
- 6 Plans (Hotspot 5/10/20Mbps, PPPoE 10/20/50Mbps)
- 3 Routers (Nairobi HQ, Karen Branch, Westlands)
- 5 Transactions
- 5 Vouchers

## Development Commands
```bash
# Start all services
pnpm run dev

# DB schema push
pnpm --filter @workspace/db run push

# API codegen
pnpm --filter @workspace/api-spec run codegen
```

## Key Decisions
- All data is mock/static in the frontend for initial render (realistic Kenyan data)
- Auth is simulated (any credentials work for demo)
- Backend API routes exist for real CRUD operations
- MikroTik router management is UI-only (no actual RouterOS API calls)
- M-Pesa integration is UI-only (no live Daraja API keys)

## GitHub Repository
- **Remote origin**: https://github.com/ocholasupernet-debug/BIL.git
- All project commits are pushed to the `main` branch on GitHub
- Secrets (Supabase keys, GitHub PAT) are stored in Replit Secrets — NOT in .replit or any tracked file

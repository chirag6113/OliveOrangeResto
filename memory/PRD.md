# PRD — Café Smart Ordering & Management System

## Original Problem Statement
QR-based web platform: customers scan table QR → order from digital menu → pay; staff manage orders, tables, billing, discounts, analytics from live admin panel. Model: Table → Session → Orders → Bill → Payment. Multi-tenant ready (cafe_id on every doc). INR, GST 5% default, service charge configurable (0% now).

## User Choices
- Theme: olive + orange (explicit)
- Minimal credit usage (explicit)
- Twilio WhatsApp: MOCKED (notifications logged to `notifications` collection)
- KOT: deferred; Object storage: deferred (stock image URLs); Online gateway: disabled (hook-ready)

## Architecture
- Backend: FastAPI + MongoDB (motor), single /app/backend/server.py, all routes /api/*, WebSockets /api/ws/cafe/{cafe_id} + /api/ws/session/{token}
- Frontend: React (CRA/craco), Tailwind, olive-orange theme (Fraunces + Outfit fonts), pages under /app/frontend/src/pages/
- Auth: staff JWT (Bearer, bcrypt) — owner oliveorangetechnologies@gmail.com/Admin@123, manager, cashier; customers anonymous session token (localStorage)
- Collections: cafes, users, tables, sessions, categories, menu_items, orders, bills, notifications, audit_logs

## Implemented (2026-06-08)
- Phase 1: staff auth, cafe/table/QR seed, menu mgmt (categories/items/add-ons/sold-out), customer QR flow (session create/resume, menu, cart w/ add-ons, idempotent order w/ server price+tax), live order status, staff order panel (accept/reject+reason/preparing/ready/served), WebSocket live updates
- Phase 2 (core): bill request → lock → role-based discount (cashier flat≤100, manager %≤15, owner unlimited) → split payments (cash/UPI/card) → PAID → session close → table AVAILABLE; table map w/ states + maintenance; audit log; dashboard (sales, AOV, active tables, pending orders/bills, payment mix, best sellers)

## Verified
- Full curl E2E passed: order ₹252 → 10% discount ₹228 → split cash+UPI → PAID → table released; idempotency dedupe confirmed; dashboard/audit correct.

## Backlog
- P0: none pending from MVP core
- P1: Refunds/cancellations UI (backend cancel exists for manager+), bill PDF (WeasyPrint) + reprint, reports export (CSV), analytics page (peak hours, per-table revenue), staff management UI, settings UI (tax/service charge/branding)
- P2: Real Twilio WhatsApp (needs user credentials), object storage for menu images, online gateway (Razorpay/Stripe), KDS, KOT print, offline resync, multi-café onboarding

## Next Tasks
1. Bill PDF generation + print/reprint
2. Analytics dashboards + exportable reports
3. Staff & settings management UIs
4. Real WhatsApp via Twilio when credentials provided

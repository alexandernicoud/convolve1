# Commercial launch: blockers, Stripe live configuration, migrations, rollback

Status on 2026-10-28: **not ready for a paid launch.** Production runs with billing off
(no `BILLING_*` or `STRIPE_*` variables on `convolve-backend-pipeline`). Nothing below has
been applied to production.

## Blockers (each must be resolved or explicitly accepted by the operator)

1. **Market data licence.** Generator, Optimizer, Backtester, paper bots and the Generator
   preview fetch prices from Yahoo Finance through `yfinance` (`app/services/generator_plan.py`
   `fetch_history`, `app/main.py` `_preview_fetch_history` and `/api/yfinance/search`,
   `app/bot_runner.py`). Bars are stored per dataset (`provenance/ohlcv/<SYMBOL>.csv`) and
   chart images rendered from them are downloadable (`training-dataset-<run>.zip`). The
   installed yfinance package states it is "not affiliated, endorsed, or vetted by Yahoo",
   "intended for research and educational purposes" and that "the Yahoo! finance API is
   intended for personal use only" (`yfinance-1.3.0.dist-info/METADATA`). Convolve holds no
   agreement with Yahoo. Selling access to features built on this data is therefore not
   cleared. Options: a vendor whose licence explicitly covers display/derived use in a paid
   SaaS (for example Polygon/Massive, Tiingo, Twelve Data, EODHD, Alpaca market data,
   Databento; terms and prices must be checked per vendor and plan), or a written licence
   from Yahoo. The data layer is concentrated in the functions above, so a provider switch
   is a contained change. Not resolved. Shortlist (October 2026, terms to be confirmed in
   writing): Tiingo Start-up redistribution licence ($250/month; recommended, needs a written
   exception covering chart display, chart/dataset exports and model training), Twelve Data
   Venture ($149/month display; exports likely need Enterprise at $1,099/month), Intrinio
   Startup ($333 rising to $999/month; US only). Massive ($2,499/month, training barred
   without an order form), EODHD (redistribution from $2,499/month), Databento, Alpaca, FMP and
   Alpha Vantage were ruled out on price or licence.
2. **Legal review.** Subscription and Credit Terms and the Refund Policy carry visible
   "draft pending legal review" notices; they stay until counsel removes them. Open facts:
   VAT/OSS registration and whether prices include VAT, the Stripe contracting entity, the
   withdrawal-right wording and model form for EU/UK consumers, whether the 50 % retention
   is permitted in each target market, and the Swiss law position.
3. **Pipeline capacity.** `convolve-backend-pipeline` runs with `maxScale 1` and
   `containerConcurrency 1` (2 vCPU / 8 GiB). Generator, analysis, optimizer and backtests
   run in that one instance, so paid users share one request slot. Raising either value is
   an infrastructure decision (not done automatically). Paper bots run serially in
   `convolve-run-due-bots` (1 task, 1800 s timeout, every 15 min), roughly 1,300-3,400 bot
   runs per day; this is why Professional stays at 10 deployments.
4. **Tax.** Stripe Tax and price tax behaviour (`tax_behavior` is "unspecified" on synced
   prices) must follow the VAT decision in 2.

## Stripe live configuration (after explicit approval only)

- Products and prices: `scripts/stripe_sync_catalog.py --live --confirm-account acct_...`
  with `STRIPE_SECRET_KEY=sk_live_...`, `CONVOLVE_STRIPE_LIVE_APPROVED=1` and the production
  `BILLING_RETURN_URL`; a dry run first, then `--apply`. Creates the 3 tiers, 3 packs and the
  customer-portal configuration (payment methods and invoices only).
- Webhook endpoint: `https://<pipeline API>/api/billing/webhook/stripe`, events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`.
- Secrets in Secret Manager (from stdin, never in shell history): `STRIPE_SECRET_KEY` (a
  restricted key with Checkout, Customers, Subscriptions, Invoices, Refunds, Balance
  transactions and Billing portal write access is enough), `STRIPE_WEBHOOK_SECRET`.
- Env on the API: `BILLING_MODE=live`, `BILLING_LIVE_APPROVED=1`, `BILLING_PROVIDER=stripe`,
  `BILLING_RETURN_URL=https://www.we-convolve.com/account?tab=plan` (exactly the host users
  sign in on; the session is stored per origin, so a different host signs them out on return),
  `ADMIN_USER_IDS`,
  `RESEND_API_KEY`/`CONTACT_*` for citation notifications. Keep `BILLING_BLOCKED_COUNTRIES`
  at its default (US and territories).
- Dashboard settings: Smart Retries and failed-payment emails (dunning), Checkout promotion
  codes (coupons are created in the dashboard), refund permissions limited to the owner,
  statement descriptor, Stripe Tax per the VAT decision.

## Migrations

Pending on top of `d2a7f4c9b351` (production head assumed from the last release; verify
with `alembic current` before upgrading): `6b1d0e8a4c27` (billing), `9c4e2b7d1f53`
(feedback, contact), `a3f8c1e5b902` (referrals, citations). All additive; new tables get
RLS and no browser grants. Take a backup with `deploy/supabase_lockdown/backup.py` first.
Downgrade drops only the new tables.

## Beta accounts

`python -m scripts.grant_beta_access --activation <ISO time>` (dry run) then `--apply
--confirm <N>`: 60 days of complimentary Research from the activation time for accounts
created before it, 150 credits per 30 days, no Stripe objects, nothing renews. Accounts
with a paid subscription are skipped; running it twice changes nothing.

## Rollback

Set `BILLING_MODE=off` (one env change, new revision): checkout, plan changes and
enforcement stop at once. The webhook then answers 404 and Stripe retries deliveries for up
to three days, so a rollback shorter than that loses no events. Stripe subscriptions
keep billing until cancelled in Stripe, so pause collection there if billing must stop
too. No data is deleted by switching off.

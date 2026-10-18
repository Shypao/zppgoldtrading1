# Public Daily Rates Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only, independent public daily-rate sheet and display it read-only on the customer landing page.

**Architecture:** Store the public sheet in `pricing.publicDailyRates`, but never derive missing public values from internal daily-rate settings. The admin editor writes this sheet through the authenticated pricing endpoint; the public page reads it through `GET /api/public-pricing` and renders only published values.

**Tech Stack:** TypeScript, vanilla browser JavaScript/HTML/CSS, Node test runner, existing HTTP API and Turso/local persistence.

**Spec:** `docs/superpowers/specs/2026-10-19-public-daily-rates-integration-design.md`

## Global Constraints

- Admin only can edit or publish public daily rates.
- Internal Daily Rate Setup and public daily rates are independent; no automatic copying or calendar/market refresh.
- Public customers never receive a write control or authenticated pricing history.
- Preserve the existing landing-page branding and existing dashboard behavior.
- Run `npm run build`, `npm test`, and `git diff --check` before completion.

## Review Focus

- Missing public sheet must not silently fall back to internal rates; test an unavailable/empty public sheet response.
- Staff/non-admin pricing writes must return `403` and leave public rates unchanged.
- Partial or invalid public-rate payloads must be rejected without overwriting the last valid sheet.
- Public page must show loading/error states without hiding the rest of the page.
- Gold/Silver/Platinum values must remain grouped and preserve labels/order.

### Task 1: Protect and isolate the public-rate API

**Files:**
- Modify: `src/server.ts:1000-1040, 1110-1130`
- Test: `tests/public-pricing.test.mjs` (create)

**Interfaces:**
- Produces `GET /api/public-pricing` response `{ effectiveDate, unit, rates }` using only `pricing.publicDailyRates`.
- Produces admin-only public-rate writes through the existing `PUT /api/pricing` path.

- [ ] **Step 1: Write failing API tests** for an empty public sheet, a populated public sheet, a non-admin write, and an invalid public sheet.
- [ ] **Step 2: Run `node --test tests/public-pricing.test.mjs`** and verify the new assertions fail against the current internal-rate fallback behavior.
- [ ] **Step 3: Implement validation and isolation** in `src/server.ts`: require an independent `publicDailyRates` payload for public values, return no misleading derived rates when absent, and reject non-admin public-rate mutations with `403` without persisting changes. Keep existing staff edits to internal rates working.
- [ ] **Step 4: Run the focused API tests** and verify all pass.
- [ ] **Step 5: Commit** with `git add src/server.ts tests/public-pricing.test.mjs && git commit -m "fix: isolate public daily rates"`.

### Task 2: Make the admin editor a separate public-rate workflow

**Files:**
- Modify: `public/app.ts:410-500, 910-935`
- Modify: `public/app.js` (generated client output)
- Test: `tests/public-pricing-ui.test.mjs` (create or extend existing UI assertions)

**Interfaces:**
- Consumes the API contract from Task 1.
- Produces `openPublicDailyRatesEditor()` and `savePublicDailyRates()` that edit only `db.pricing.publicDailyRates`.

- [ ] **Step 1: Write failing UI/source tests** asserting the admin button exists, editor fields are independent, and no “Use internal rates” reset/fallback action remains.
- [ ] **Step 2: Run the focused UI/source tests** and verify they fail because the current editor pre-fills from internal rates and offers an internal-rate reset.
- [ ] **Step 3: Update `public/app.ts`** so the new admin button opens blank/previously published public values, requires all configured public grades and effective date, and never calls internal `metalRate`/`dailyFormula` as a fallback. Keep `adminEditGuard()` and preserve existing internal rate controls.
- [ ] **Step 4: Rebuild client output** so `public/app.js` matches the TypeScript source, then run focused tests and verify they pass.
- [ ] **Step 5: Commit** with `git add public/app.ts public/app.js tests/public-pricing-ui.test.mjs && git commit -m "feat: add independent admin public rate editor"`.

### Task 3: Add read-only rates to the public landing page

**Files:**
- Modify: `public/website.html`, `public/website.css`, `public/website.js`
- Modify: `zpp-gold-trading-website/website.html`, `zpp-gold-trading-website/website.css`, `zpp-gold-trading-website/website.js`
- Test: `tests/public-website.test.mjs`

**Interfaces:**
- Consumes `GET /api/public-pricing` from Task 1.
- Produces a read-only rates section with `#public-rates`, loading, unavailable, and retry states.

- [ ] **Step 1: Write failing landing-page tests** for the section, grouped metal headings, effective-date label, read-only wording, and retry/error hooks.
- [ ] **Step 2: Run `node --test tests/public-website.test.mjs`** and verify the new assertions fail.
- [ ] **Step 3: Add the responsive rate markup/styles** while preserving existing hero, services, location, and footer content.
- [ ] **Step 4: Implement the fetch/render flow** in both website scripts: request the endpoint, format PHP per gram values with thousands separators, render grouped rates, and expose a retry button on failure. Do not add edit controls or public write requests.
- [ ] **Step 5: Run the focused landing-page tests** and verify they pass.
- [ ] **Step 6: Commit** with `git add public/website.* zpp-gold-trading-website/website.* tests/public-website.test.mjs && git commit -m "feat: show public daily rates on landing page"`.

### Task 4: Full verification and deployment

**Files:**
- Modify: only files required by prior tasks after verification failures.

- [ ] **Step 1: Run `npm run build`** and confirm both server and client TypeScript compile.
- [ ] **Step 2: Run `npm test`** and confirm the full suite passes.
- [ ] **Step 3: Run `git diff --check`** and confirm no whitespace errors.
- [ ] **Step 4: Preview the landing page and admin flow locally**, confirming public users cannot edit rates and admin can publish a separate sheet.
- [ ] **Step 5: Deploy with `npx --yes vercel@59.26.0 --prod --yes --scope zpp-gold-trading`**, then verify `/api/health` and the public page.
- [ ] **Step 6: Commit any final fixes** with a focused message and report the production URLs.

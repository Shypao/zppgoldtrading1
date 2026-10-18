# Public Daily Rates Integration Design

## Outcome

Connect the customer-facing ZPP Gold Trading landing page to the trading
software's saved public daily buying rates. Customers can view the current
rate sheet without signing in, while only authenticated administrators can
edit and publish those rates.

## Scope

- Keep the existing authenticated trading-software editor as the only place
  where public daily rates can be changed.
- Enforce administrator-only writes for the public-rate settings endpoint.
- Expose the already-supported public pricing read endpoint to the landing
  page with no customer authentication requirement.
- Add a responsive “Current daily buying rates” section to the public page,
  grouped as Gold, Silver, and Platinum, showing the effective date and PHP
  per gram values.
- Include loading, unavailable, and retry states so a temporary API/network
  failure does not make the rest of the landing page unusable.
- Keep both public-page source copies in sync when they are part of the same
  repository: `public/website.*` and `zpp-gold-trading-website/website.*`.

## Security and data flow

1. An administrator signs in to the trading software and edits public daily
   rates using the existing editor.
2. The authenticated pricing write path validates the user's administrator
   role before saving `publicDailyRates`.
3. The public page calls `GET /api/public-pricing` and receives only the
   effective date, unit, and public rate values. No session, account, or
   private pricing history is returned.
4. The public page never sends a write request and has no edit control.

If a non-admin session attempts to write public-rate settings, the API must
return `403` and leave the saved rates unchanged.

## Failure handling

- Show a small loading indicator while rates are requested.
- On a failed request or malformed response, show a clear “Rates currently
  unavailable” message with a retry action; keep business/contact sections
  usable.
- Treat missing individual grades as absent data rather than rendering
  misleading zero values.

## Verification and acceptance criteria

1. Admin can edit and save public rates from the trading software.
2. Staff/non-admin cannot save public-rate changes and receives `403`.
3. The landing page displays the saved effective date and rates by metal.
4. The landing page remains usable when the pricing endpoint is unavailable.
5. Public-page tests cover markup, grouped rate rendering, and error state.
6. Existing build and test suites pass without regressions.

## Out of scope

- Customer accounts or public editing.
- Changes to internal buying/inventory calculations.
- A new database or external pricing provider.
- Automatic rate changes based on the calendar or market feeds.

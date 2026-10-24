# Production public website

Canonical static sources for the existing **zpp-public-website** Vercel project in the **ZPP / zpp-gold-trading** Pro team. This directory preserves the deployed public design and photos, independently of the unfinished redesigns elsewhere in the repository.

Deploy this directory, not the internal app's `public/` directory. The internal app remains the separate `zppgoldtrading1` project.

The website reads only `https://zppgoldtrading.vercel.app/api/public-pricing`. Administrators publish that saved sheet with **Edit public website rates → Save public rates** in the internal app. Internal buying-rate edits, ledger saves, and internet prices must not alter this sheet. There are no hardcoded fallback prices or market-price calculations on this website.

An open page checks the saved public sheet every 30 seconds while visible and when it regains focus. This is a read-only synchronization, not automatic price generation. Calculator purity and weight selections are preserved. If a refresh fails, the last successfully loaded sheet remains visible with a warning; an initial failure shows an unavailable message instead of inventing prices.

Run regression checks from the repository root:

```sh
node --test tests/deployed-public-rates.test.mjs tests/pricing-isolation.test.mjs
```

Deploy a clean copy of this directory from a committed `main` revision with the public project's Vercel link and `--prod --scope zpp-gold-trading`.

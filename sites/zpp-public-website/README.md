# Production public website

Canonical static sources for **ZP Gold Trading**, using the existing **zpp-public-website** Vercel project in the **ZPP / zpp-gold-trading** Pro team. This directory is independent of the unfinished redesigns elsewhere in the repository. The owner approved the brand, Facebook account, and section consolidation on October 27, 2026.

## Local review — deployment on hold

Run `node scripts/preview-public-site.mjs` from the repository root and open `http://127.0.0.1:4178/website.html`. Set `PUBLIC_SITE_PORT` to use another port. This is a static UI server, not the internal software. It reads the production **public** sheet but has no pricing-write routes. Reload after changing source files.

The owner requested localhost review before deployment. Do not push or deploy this redesign until approved.

Deploy this directory, not the internal app's `public/` directory. The internal app remains the separate `zppgoldtrading1` project.

The website reads only `https://zppgoldtrading.vercel.app/api/public-pricing`. Administrators publish that saved sheet with **Edit public website rates → Save public rates** in the internal app. Internal buying-rate edits, ledger saves, and internet prices must not alter this sheet. There are no hardcoded fallback prices or market-price calculations on this website.

An open page checks the saved public sheet every 30 seconds while visible and when it regains focus. This is a read-only synchronization, not automatic price generation. Calculator purity and weight selections are preserved. If a refresh fails, the last successfully loaded sheet remains visible with a warning; an initial failure shows an unavailable message instead of inventing prices.

Run regression checks from the repository root:

```sh
node --test tests/deployed-public-rates.test.mjs tests/pricing-isolation.test.mjs
```

Deploy a clean copy of this directory from a committed `main` revision with the public project's Vercel link and `--prod --scope zpp-gold-trading`.

## Presentation and owner follow-up

- Confirmed name: **ZP Gold Trading**. All Facebook actions use the supplied `https://web.facebook.com/profile.php?id=61593068612385`; no guessed Messenger username or phone number.
- Rates and estimator now lead the page. Karats and percentages are grouped and sorted for display, without mutating the API payload or prices. Original peso rounding is preserved.
- The API supplies only `effectiveDate`. The UI says **Save time not recorded** and asks visitors to confirm rates when the sheet is not dated today in Manila. It never fabricates a save timestamp.
- Approved consolidation replaces duplicate service/XRF explanations, the flyer slide, and separate hours/contact sections. Existing photos remain available; photo captions no longer overlap images. Slideshow playback is opt-in, pausable, and disabled for reduced-motion preferences.
- Needed: shop phone number (currently `[PHONE]`), photos of the scale and XRF testing area, and confirmation of accepted grades beyond the flyer. Review 5K at PHP 195 versus 8K at PHP 1,950 and the equal 18K/18K-Buo prices. No rate was corrected automatically.
- Hero alternative: **Selling gold or silver in Zamboanga?** / **Check the published rates, enter your item’s weight, or message the shop before bringing it in.**
- Further suggestions: supply an exact shop map pin; confirm pawn-ticket requirements; review the Facebook link preview after release.

Local checks: five widths (360, 390, 768, 1024, 1440), decimal/invalid calculator input, local message drafting, native FAQ keyboard behavior, and gallery controls. Lighthouse mobile baseline: performance **99**, accessibility **100**, best practices **100**, SEO **100**; results are local measurements, not a production guarantee. Theme text contrast has regression tests. No third-party fonts or new runtime dependencies were added.

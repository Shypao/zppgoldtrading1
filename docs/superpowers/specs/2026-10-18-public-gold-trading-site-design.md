# Public Gold Trading Site Design

## Outcome

Create a simple, mobile-friendly public landing page for ZPP Gold Trading. The page will help local customers understand what the business offers, find the store, check opening hours, and start a conversation or request a quote. It will be developed locally and will not be deployed as part of this task.

## Scope

- A public landing page with a warm gold, cream, and charcoal visual system inspired by the supplied store-location graphic.
- Hero content for Gold & Silver Trading with primary actions to visit the store and message the business.
- Business/location details: Barcelona Street, Zamboanga City; landmark Puregold Center / JW Gadgets; daily hours of 10:30 AM–6:00 PM.
- A location section displaying the supplied reference graphic.
- A contact section with a Facebook link and a simple get-a-quote call to action.
- Responsive behavior for mobile and desktop.

## Out of scope

- Deployment, hosting, domain configuration, or production analytics.
- Customer accounts, inventory display, pricing APIs, database changes, or dashboard changes.
- A live map integration or a quote submission backend. The first version will use clear links and contact prompts.

## Technical approach

Use the existing public page entrypoint and static assets so the internal dashboard remains unchanged. Add the public landing-page markup and styles in a dedicated page/template path or clearly isolated public-page mode, reusing the project’s existing branding asset where useful. Keep external links and contact details easy to update.

## Acceptance criteria

1. A visitor can understand the business and its primary action within the first viewport.
2. Store address, landmark, hours, and contact action are visible without needing an account.
3. The supplied image is presented as a useful location reference and remains legible on small screens.
4. The page is usable at narrow mobile widths and desktop widths.
5. Existing internal dashboard behavior and tests are not regressed.
6. The site is only prepared and previewable locally; no deployment occurs.

## Verification

- Run the project typecheck/build.
- Run the existing automated test suite.
- Preview the public page locally and inspect the layout at mobile and desktop widths.

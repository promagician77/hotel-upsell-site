# Upsell desk demo site

Static demo of hotel upsell automation. Open `index.html` through any static server, or deploy
the folder to Vercel as it is (no build step; `vercel.json` sets noindex and a strict CSP).

The page runs the same engine modules as the service (`js/engine/`) in the browser, with
in-page stand-ins for the PMS, email and CRM and a demo clock that starts on Sunday
22 November 2026 at 09:00 hotel time. Hotel Meridiana, its guests and prices are invented.

## Measured

| Check | Result |
|---|---|
| Engine tests (time zones, schedule, offer rules, counters, signed links, emails, 30-day run) | 34 of 34 pass on Node v22.23.4 |
| End-to-end over HTTP: the service, a SQLite file and local PMS, email and CRM servers | 18 of 18 cases behave as expected; 0 duplicate folio charges |
| Same booking webhook delivered 3 times | 1 reservation, 1 confirmation email |
| Cancellation delivered before the booking | 0 emails sent, 0 rooms held |
| Last parking space, 5 guests booking at once | 1 booked, capacity 10 never exceeded; a check-then-book version sold it 5 times |
| PMS times out after posting a charge, then the job retries | 1 charge with the idempotency key; 2 if the PMS ignored the key |
| PMS down for good | 6 attempts over about 5 hours, then dead-letter list and a staff alert; no charge lost or doubled after a restart |
| Local send times, 10,000 random times in 4 zones over 2026 to 2028 | 10,000 of 10,000 exact, including daylight-saving days |
| Message plans for 10,000 random bookings | 0 offers in quiet hours; 0 after check-in; pre-arrival offers at 10:00 local in 8,693 of 8,693 cases |
| 30 simulated days of a 42-room hotel with random guest replies | 392 reservations, 1,462 emails, 422 extras booked; 0 parking nights or late slots oversold; every extra charged once |
| Booking webhook processing | 0.2 ms per reservation in memory |
| Demo page in Chromium (axe at 1360 px and 390 px, every local link, autoplays under the page CSP, clicks and keyboard) | 0 accessibility violations on 12 views; 0 of 10 views overflow; 0 of 27 links broken; 4 of 4 autoplays and 9 of 9 interaction checks as expected; 0 console errors |

## Not measured

- A real PMS. Webhooks follow Apaleo’s documented behaviour (repeats, any order), but no Apaleo, Mews or Cloudbeds account was used; folio charges and room changes go to a local stand-in.
- Real email delivery: SPF, DKIM and DMARC set-up, inbox placement and spam rates. The demo writes the headers; it sends nothing.
- Payments by card. Extras go on the guest’s bill at checkout; taking a card payment up front would add a payment provider.
- Guest acceptance rates. The 30-day run uses random replies to test the plumbing, not to forecast revenue.
- Load beyond one hotel, and a multi-server set-up on Postgres. The SQLite version locks with transactions; a hosted version would use the database the same way.
- Prices, capacities and email wording, which are placeholders for the hotel to set; translations were not reviewed by native speakers.

Fonts: Newsreader and Schibsted Grotesk, SIL Open Font License (`fonts/OFL-*.txt`).

Prepared by Santiago.

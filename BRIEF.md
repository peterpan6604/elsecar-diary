# Elsecar Club Diary: Brief

Source of truth for the build. Update this file when a decision changes.

## What it is

A shared diary for Elsecar Sports & Social Club:

- **Committee and staff** (about 10 people) see and edit everything, using **one shared code** (no individual PINs, no Google logins).
- **The public** see what's on and which dates the **function room** is free, and can **request a booking**. There's no deposit and no payment.
- **Play-Cricket** fixtures for Elsecar CC load in automatically.
- Embedded on the club website **elsecarcc.co.uk** (a Google Site).

Clickable mock-up: https://claude.ai/artifact/TtnaBV9yYDY44d6ZJBkP4C

## Decisions (agreed with Pete, 2026-11-01)

| Topic | Decision |
|---|---|
| Account | Everything runs on the `elsecarsportsandsocialclub1854` Google account, same as the clocking system |
| Access | One shared code. Each person types their first name, which is used only for the change log. Logged in for 30 days. Changing the code logs everyone out |
| Committee entry point | Separate link saved to phone home screens, plus a small "Committee" link on the website |
| Public bookings | Function room only. **Instant booking** (changed 1 Nov 2026, see "Online booking rules" below) |
| Deposit | None |
| Prices | None yet; a price list comes later |
| Booking alerts | Emailed to **all** committee addresses (listed in the Settings tab) |
| Public label for an approved booking | **"Private party"** (no names or details) |
| Clash checks | Function room bookings only. Cricket fixtures never clash (separate venue) |
| Existing diary to migrate | None |

## Online booking rules (agreed 1 Nov 2026)

**Sessions:** Afternoon 12pm to 5pm, Evening 6pm to midnight, or Whole day (both). Two bookings a day are possible.

**Flow:**
1. The customer picks a free date and session and fills in the form.
2. The session is **held** and an email goes out with a "Confirm my booking" link. If they don't click it within 24 hours, the hold is released automatically.
3. When they click, the booking is **confirmed instantly**. They get a confirmation email with the hire terms, a calendar invite (.ics) and a "Cancel my booking" link. All committee emails get an alert.
4. A **bar cover reminder** is added to the committee diary automatically (Bar & staffing, same session).
5. **7 days before**, a reminder email asks them to confirm it's still going ahead, with the cancel link.

**Safeguards:**

| Rule | Setting |
|---|---|
| Minimum notice | 7 days. Shorter notice is refused, except funeral wakes, which become a request |
| Furthest ahead | 12 months |
| One booking at a time | 1 upcoming booking per email or phone number |
| Needs committee approval | 18th and 21st birthdays, and short notice wakes |
| Guests | Maximum 75 (fire limit), refused above that |
| Committee blocks | Any diary item ticked "Uses the function room" blocks its session |
| Committee cancels | Any booking, with a reason that's emailed to the customer. The bar cover reminder is removed |

**Approval:** Needs approval items appear in the committee view with Approve and Decline. Approve confirms the booking and adds bar cover. Decline releases the session.

## Architecture

```
elsecarcc.co.uk (Google Site) ── embeds ──► Diary page (GitHub Pages)
                                              │ public view / committee view
                                              ▼
                               Apps Script web app (club account)
                                ├─ Google Calendar "Club Diary": every confirmed event
                                ├─ Google Sheet "Club Diary Admin"
                                │    Bookings (customer contact details, status)
                                │    Change log (who changed what)
                                │    Settings (alert emails, room capacity, hire terms)
                                ├─ Emails sent from the club account
                                └─ Daily 6am job: Play-Cricket API → calendar
```

- **Customer phone numbers and emails stay in the Sheet**, never in the calendar. That keeps them off committee phones that subscribe to the calendar.
- Event type, the public flag and the source are stored as tags on each calendar event.
- An event someone adds straight into Google Calendar (with no tags) is treated as a committee-only "Club event", so it is never published by accident.

## Brand (from elsecarcc.co.uk and the crest)

Navy `#1d3557`, gold `#E5A825`, amber `#E8A050`, site blue `#0059C1`, text `#1C1C1C` on `#F9F9F9`, dark sections `#0a1a3d` / `#050b1f`. Headings in Roboto Serif 800, body in Montserrat. The crest is a navy and gold trophy on white.

## Security rules (lessons from the clocking system)

- The Apps Script URL is public. **Every request is checked on the server**, and the page is never trusted.
- The shared code lives only in Script Properties, never in the code or the page.
- Sign-in is a signed token (HMAC). There's a lockout after 5 wrong attempts per device, plus a club-wide limit.
- The public endpoint returns only safe fields. Room bookings come back as "Private party", with no names or notes.
- Any value that starts with `= + - @` is neutralised before it's written to the Sheet.
- Booking form: hidden spam field and a rate limit.
- Customer contact details are deleted 6 months after the event (monthly job).

## Deployment rules (lessons from the clocking system)

- Apps Script updates: **Deploy → Manage deployments → pencil → New version**. Never "New deployment" after the first one, because that silently creates a second web address.
- After every redeploy, check `<exec-url>?action=ping` in a browser.
- This folder is the git repo, and the published page sits at its root. There's no separate `hosting/` copy.
- GitHub Pages caches pages for about 10 minutes. Hard-refresh before deciding a change hasn't worked.

## Stages

| # | Stage | Status |
|---|---|---|
| 0 | Club prep: Play-Cricket API token and site ID, committee emails, room capacity, hire terms, choose the code | **Waiting on club** |
| 1 | Backend: calendar, sheet, login, read, add/edit/delete, change log, public read | **Code written, not yet deployed** (`apps-script/Code.gs`, `SETUP.md`) |
| 2 | Committee view (real page from the mock-up), phone subscription and guide | **Built, tested in demo mode, not yet live.** `committee.html` (try `?demo=1`), `COMMITTEE-GUIDE.md`. Needs stage 1 deployed and the `/exec` URL in `config.js` |
| 3 | Public view, instant booking by session (email confirm link, 24 hour hold, safeguards), emails and .ics, bar cover, approvals, cancel links, 7 day reminder, spam protection, data clean-up | To do (about 1.5 to 2 days, up from 1 to 1.5) |
| 4 | Play-Cricket daily sync | To do (needs the token) |
| 5 | Embed on the website, committee test, security check, handover notes | To do |

## Open items

- Play-Cricket API token and site ID: Pete is chasing these.
- Room capacity: **75** (confirmed 1 Nov 2026).
- Hire terms: draft in `HIRE-TERMS.md`. The committee needs to fill in the **[confirm]** items. It becomes a terms page linked from the booking form in stage 3.
- Committee emails: Pete is dropping the list into `private/` (excluded from git).

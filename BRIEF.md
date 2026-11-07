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
| Public bookings | Function room only. **Request and approve** (changed 7 Nov 2026, see "Booking request rules" below). Replaces the instant booking agreed on 1 Nov 2026 |
| Deposit | None |
| Prices | None yet; a price list comes later |
| Booking alerts | Emailed to **all** committee addresses (listed in the Settings tab) |
| Public label for an approved booking | **"Private party"** (no names or details) |
| Clash checks | Function room bookings only. Cricket fixtures never clash (separate venue) |
| Existing diary to migrate | None |

## Booking request rules (decided 7 Nov 2026)

Pete decided on 7 Nov 2026 to use **request and approve** instead of instant booking, because it is less to build and less to go wrong. The instant booking design agreed on 1 Nov 2026 (email confirm link, 24 hour hold, customer cancel link, 7 day reminder, .ics invite) is dropped.

**Sessions:** Afternoon 12pm to 5pm, Evening 6pm to midnight, or Whole day (both). Two bookings a day are possible.

**Flow:**
1. On the public page the customer picks a date and session and fills in the request form: name, phone, email, date, session, type of event, guest numbers and a message.
2. The request is saved in the Bookings tab as **Pending**. The customer gets an email saying it is a request, not a booking. Every committee address in Settings gets an alert (no contact details in it).
3. A pending request does **not** block the session on the public page. The committee page shows a clash warning if two requests, or a request and a booking, want the same session.
4. **Approve** (committee page): the server checks the session is still free, adds a "Private party" event (room tag, no contact details) and a **bar cover reminder** (Bar & staffing, same session) to the diary, and emails the customer a confirmation with the hire terms link from Settings (or says the club will send the terms).
5. **Decline** (committee page): optional reason, emailed to the customer.
6. **Cancel** an approved booking (committee page): reason required, emailed to the customer. The booking and its bar cover reminder are removed from the diary.

**Safeguards (all checked on the server):**

| Rule | Setting |
|---|---|
| Minimum notice | 7 days. Funeral wakes can be requested from tomorrow |
| Furthest ahead | 12 months |
| Guests | Maximum 75 (fire limit). The Settings tab can lower it, never raise it |
| Session must be free | No approved booking and no committee item ticked "Uses the function room" |
| Spam | Hidden spam field, a 3 second minimum to fill in the form, 3 requests per device and 20 club-wide every 6 hours, 2 open requests per email address. The acknowledgement email holds only the club's own wording (no name or anything typed) |
| Email allowance | New requests are refused when fewer than 30 emails are left for the day, keeping them for approve, decline and cancel. A failed email shows as "Needs attention" on the committee page |
| Past requests | A pending request whose date has passed stays in Needs approval with Decline only, so every customer gets a reply |
| Online bookings in the diary | Can't be edited or deleted as ordinary items. Use Cancel so the customer is told |
| Contact details | In the Bookings tab and on the signed-in committee page only. Removed 6 months after the event, or 30 days after a decline (monthly job). A privacy notice on the form says this, with the "Privacy contact" from Settings |
| Committee room items | Ticking "Uses the function room" on a session a customer has booked is refused by the server |
| Sessions | An item takes a session only if it overlaps it. A 9am to 12 noon item blocks nothing bookable |

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
| 1 | Backend: calendar, sheet, login, read, add/edit/delete, change log, public read | **Live** on the club account (`apps-script/Code.gs`, `SETUP.md`) |
| 2 | Committee view (real page from the mock-up), phone subscription and guide | **Live** on GitHub Pages (`committee.html`, `COMMITTEE-GUIDE.md`) |
| 3 | Public view, booking **requests** by session, committee approve / decline / cancel, emails, bar cover, spam protection, data clean-up | **Built on branch `stage3-requests`, tested in demo mode, not yet live.** `index.html` (try `?demo=1`), `EMBED.md`. Needs the new `Code.gs` pasted in, `setupStage3` run, and a review before release |
| 4 | Play-Cricket daily sync | To do (needs the token) |
| 5 | Embed on the website, committee test, security check, handover notes | To do |

## Open items

- Play-Cricket API token and site ID: Pete is chasing these.
- Room capacity: **75** (confirmed 1 Nov 2026).
- Hire terms: draft in `HIRE-TERMS.md`. The committee needs to fill in the **[confirm]** items. Once agreed, put its web link in the Settings tab ("Hire terms link"). It then shows on the request form and in confirmation emails.
- Committee emails: Pete is dropping the list into `private/` (excluded from git).

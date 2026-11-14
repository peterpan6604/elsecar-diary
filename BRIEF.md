# Elsecar Club Diary: Brief

Source of truth for the build. Update this file when a decision changes.

## What it is

A shared diary for Elsecar Sports & Social Club:

- **Committee and staff** (about 10 people) see and edit everything, using **one shared code** (no individual PINs, no Google logins).
- **The public** see what's on and which sessions the **function room** and the **tea room** are free, and can **request a booking** for either room. Hire is **£52**, paid by card through a Stripe Payment Link after the committee approve (from 14 Nov 2026).
- **Play-Cricket** fixtures for Elsecar CC load in automatically.
- Embedded on the club website **elsecarcc.co.uk** (a Google Site).

Clickable mock-up: https://claude.ai/artifact/TtnaBV9yYDY44d6ZJBkP4C

## Decisions (agreed with Pete, 2026-11-01)

| Topic | Decision |
|---|---|
| Account | Everything runs on the `elsecarsportsandsocialclub1854` Google account, same as the clocking system |
| Access | One shared code. Each person types their first name, which is used only for the change log. Logged in for 30 days. Changing the code logs everyone out |
| Committee entry point | Separate link saved to phone home screens, plus a small "Committee" link on the website |
| Public bookings | Function room, and the **tea room** from 14 Nov 2026. **Request and approve** (changed 7 Nov 2026, see "Booking request rules" below). Replaces the instant booking agreed on 1 Nov 2026 |
| Deposit | None. The £52 hire fee is paid in full after approval (see "Payment and refunds") |
| Prices | £52 for every booking, any room, any session (Pete, 14 Nov 2026) |
| Booking alerts | Emailed to **all** committee addresses (listed in the Settings tab) |
| Public label for an approved booking | **"Private party"** (no names or details) |
| Clash checks | Room bookings only, and each room separately. Cricket fixtures never clash (separate venue) |
| Existing diary to migrate | None |

## Tea room (decided 14 Nov 2026)

Pete decided on 14 Nov 2026 to add the **tea room** as a second room the public can hire.

- It is a **separate room**. The function room and the tea room each have their own availability, so different people can hire each one on the same day and session.
- Capacity **50** (changed from 75 on 14 Nov 2026). It has its own Settings row, **Tea room capacity**, so it can be lowered later without code. Blank means 50. It can never go above 50.
- **Same rules** as the function room: the same sessions, notice, furthest ahead, approve or decline, bar cover reminder, clash checks and emails. Emails, diary titles and committee cards name the room.
- Committee items have a **"Uses the tea room"** tick next to "Uses the function room". Each tick blocks public requests for that room only. Room hire items must have at least one room ticked.
- Everything made before the tea room (Bookings rows with no Room, and calendar events with no tea room tag) counts as the **function room**.
- On the public page each day shows the two rooms with their own sessions. The calendar shows **Free** (both rooms fully free), **Some free** or **Booked** (nothing left in either room).

## Payment and refunds (decided 14 Nov 2026)

Pete decided on 14 Nov 2026. Lean on purpose: **no Stripe API, no keys, no webhooks, no new services.**

- **Price:** £52 for every booking, either room, any session. Nothing is paid at request stage. The form, the request acknowledgement email and the hire terms all say so.
- **How they pay:** the club creates one **Stripe Payment Link** (fixed £52) in its own Stripe account and pastes it into the Settings row **Payment link**. The approval (confirmation) email gives each customer that link with `?client_reference_id=<booking ref>&prefilled_email=<their email>` added, so the payment can be matched to the booking in Stripe.
- **Only a live Stripe link is used:** it must be exactly `https://buy.stripe.com/` followed by letters and numbers. Anything else (a typo, a test mode `test_` link, another website, a link with extra bits on the end) is ignored. Blank or ignored means the email says "The club will be in touch about how to pay it."
- **When:** within 7 days of the confirmation email, or by the day of the event if that is sooner. The email gives the date. If it is not paid, the club **may** cancel (by hand, using Cancel booking). Nothing cancels automatically.
- **Checking payment:** the committee look in Stripe (by reference or email). There is no "Paid" marker in the diary. It was left out because it needs a new Bookings column, a new button and a new server action, which is more than "genuinely small".
- **Hirer cancels** (by replying to an email or contacting the club; there is no customer cancel link). Days are counted from the date the club is told to the event date:
  - 29 days or more ("more than 28 days"): **£42** back (the £52 minus a £10 admin fee)
  - 14 to 28 days: **£25** back
  - 13 days or fewer ("less than 14 days"): no refund
- **Club cancels** through no fault of the hirer: **full refund**.
- Refunds are done **by hand in Stripe** by the committee. On **Cancel booking** the committee choose "The club" or "The customer asked to cancel" (with the date they asked). The diary works out the refund, puts it in the email to the customer, shows it to the committee and writes it in the Reason column. The server refuses a cancel that doesn't say who is cancelling (an old cached committee page), so nobody is promised a full refund by mistake. The date asked can't be in the future, after the event, or before the request was sent.
- Bookings approved before this change got the old email with no payment link. The club deals with those by hand.

## Capacities (changed 14 Nov 2026)

Function room (also called the bar) **80**. Tea room **50**. These are the fire limits. The Settings rows **Room capacity** and **Tea room capacity** can lower them, never raise them. `setupPayments` changes the old default of 75 to the new limits once. Approving a request for more guests than the room now holds is refused, with a message telling the committee what to do.

## Booking request rules (decided 7 Nov 2026)

Pete decided on 7 Nov 2026 to use **request and approve** instead of instant booking, because it is less to build and less to go wrong. The instant booking design agreed on 1 Nov 2026 (email confirm link, 24 hour hold, customer cancel link, 7 day reminder, .ics invite) is dropped.

**Sessions:** Afternoon 12pm to 5pm, Evening 6pm to midnight, or Whole day (both). Two bookings a day are possible.

**Flow:**
1. On the public page the customer picks a room, date and session and fills in the request form: name, phone, email, room, date, session, type of event, guest numbers and a message.
2. The request is saved in the Bookings tab as **Pending**. The customer gets an email saying it is a request, not a booking. Every committee address in Settings gets an alert (no contact details in it).
3. A pending request does **not** block the session on the public page. The committee page shows a clash warning if two requests, or a request and a booking, want the same session in the same room.
4. **Approve** (committee page): the server checks the session is still free in that room and the guests fit, adds a "Private party (function room)" or "Private party (tea room)" event (room tags, no contact details; the public see only "Private party") and a **bar cover reminder** (Bar & staffing, same session) to the diary, and emails the customer a confirmation with the £52 payment link and pay by date, the hire terms link from Settings (or says the club will send the terms) and a summary of the refund rules.
5. **Decline** (committee page): optional reason, emailed to the customer.
6. **Cancel** an approved booking (committee page): choose who is cancelling. The club: reason required, email promises a full refund if paid. The customer asked: date they asked required, note optional, email gives the refund due. The booking and its bar cover reminder are removed from the diary.

**Safeguards (all checked on the server):**

| Rule | Setting |
|---|---|
| Minimum notice | 7 days. Funeral wakes can be requested from tomorrow |
| Furthest ahead | 12 months |
| Guests | Maximum 80 in the function room and 50 in the tea room (fire limits, from 14 Nov 2026). The Settings tab can lower either room ("Room capacity" for the function room, "Tea room capacity"), never raise it |
| Session must be free | In the room asked for: no approved booking of that room and no committee item ticked "Uses the function room" or "Uses the tea room" for it |
| Spam | Hidden spam field, a 3 second minimum to fill in the form, 3 requests per device and 20 club-wide every 6 hours, 2 open requests per email address. The acknowledgement email holds only the club's own wording (no name or anything typed) |
| Email allowance | New requests are refused when fewer than 30 emails are left for the day, keeping them for approve, decline and cancel. A failed email shows as "Needs attention" on the committee page |
| Past requests | A pending request whose date has passed stays in Needs approval with Decline only, so every customer gets a reply |
| Online bookings in the diary | Can't be edited or deleted as ordinary items. Use Cancel so the customer is told |
| Contact details | In the Bookings tab and on the signed-in committee page only. Removed 6 months after the event, or 30 days after a decline (monthly job). A privacy notice on the form says this, with the "Privacy contact" from Settings |
| Committee room items | Ticking "Uses the function room" or "Uses the tea room" on a session a customer has booked in that room is refused by the server |
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
                                │    Settings (alert emails, room capacities, hire terms)
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
| 3 | Public view, booking **requests** by session, committee approve / decline / cancel, emails, bar cover, spam protection, data clean-up | **Live** |
| 3b | Tea room as a second hireable room | **Live** |
| 3c | £52 payment by Stripe Payment Link, refunds, capacities 80 and 50, hire terms page (`hire-terms.html`) | **Built on branch `payments`, tested in demo mode, not yet live.** SETUP.md step 11 |
| 4 | Play-Cricket daily sync | To do (needs the token) |
| 5 | Embed on the website, committee test, security check, handover notes | To do |

## Open items

- Play-Cricket API token and site ID: Pete is chasing these.
- Room capacity: function room **80**, tea room **50** (Pete, 14 Nov 2026).
- Hire terms: `HIRE-TERMS.md` and the web page `hire-terms.html` (keep the two the same). The committee are happy with them in general. Still to confirm: set up access time, one free date move and its notice, tea room kitchen use, false alarm charge, parking and taxis (marked **[confirm]**). Music ends 11.30pm and guests leave by midnight (Pete, 14 Nov 2026), which matches the evening session ending at midnight.
- Stripe: the club's Stripe account and the £52 Payment Link (Pete, SETUP.md step 11).
- Committee emails: Pete is dropping the list into `private/` (excluded from git).

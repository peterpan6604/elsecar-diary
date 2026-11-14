# Stage 1 setup: Apps Script backend

Takes about 15 minutes. Do every step **signed in as the club account** (`elsecarsportsandsocialclub1854@gmail.com`). The easiest way is a private/incognito window, so your own Google account doesn't get mixed in.

## 1. Create the project

1. Go to https://script.google.com and click **New project**.
2. Rename it (top left) to **Club Diary**.
3. Click the cog (**Project Settings**):
   - Time zone: **(GMT+00:00) London**
4. Back in the **Editor**, delete everything in `Code.gs` and paste in the contents of `apps-script/Code.gs`. Save (Ctrl+S).

## 2. Run setup

1. In the function drop-down at the top, choose **setup** and click **Run**.
2. Google asks for permission. Choose the club account → **Advanced** → **Go to Club Diary (unsafe)** → **Allow**. ("Unsafe" just means the script isn't published by Google.)
3. The log at the bottom shows the calendar ID and a link to the new **Club Diary Admin** sheet.

## 3. Set the committee code

1. **Project Settings** → scroll to **Script Properties** → **Add script property**.
2. Property: `DIARY_CODE`. Value: the code you'll give the committee.
   - Use **at least 6 characters**. Don't use 1854; that was only for the mock-up and everyone can guess it.
   - Better still, use **four random words**, for example `kettle river pencil oak`. It is easy to remember and very hard to guess.
3. **Save script properties**.

To change the code later (for example when someone leaves the committee), edit this value. Everyone is logged out and needs the new code.

## 4. Test it

1. Choose **testSelf** in the function drop-down and click **Run**.
2. The log should end with "Setup works". The **Change log** tab in the sheet will show an "Added" row and a "Deleted" row.

## 5. Publish the web app (first time only)

1. **Deploy** → **New deployment** → cog → **Web app**.
2. Description: `Club Diary`. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
4. Check it: open `<that URL>?action=ping` in a browser. You should see `{"ok":true,...}`.

> **Every update after this:** Deploy → **Manage deployments** → pencil icon → Version: **New version** → Deploy.
> Never use "New deployment" again. It creates a second web address and the diary keeps using the old code. This caught us out twice on the clocking system.

## 6. Fill in the Settings tab

In the **Club Diary Admin** sheet → **Settings** tab:
- **Notification emails:** every committee email address, separated by commas
- **Room capacity:** already set (80 from step 11)
- **Hire terms link** and **Reply-to email** can wait until stage 3

## 7. Send Pete

- The `/exec` web app URL. It isn't secret.
- **Not** the code. Keep that between the committee.

## 8. Phone calendar link (stage 2, optional but wanted)

1. In Google Calendar (club account), open **Settings** for the **Club Diary** calendar.
2. Under **Integrate calendar**, copy the **Secret address in iCal format**.
3. In Apps Script: **Project Settings** → **Script Properties** → add `FEED_URL` with that address. Save.
4. Committee members then see it in the diary page under "On your phone". It is never stored in the page code, because the page is public.
5. After pasting the new `Code.gs`, redeploy: **Deploy** → **Manage deployments** → pencil → **New version**.

## 9. Stage 3 update: booking requests

Do this **after** the stage 3 code has been reviewed and Pete has said it can go live. Signed in as the club account. About 10 minutes.

1. Open the **Club Diary** Apps Script project. In `Code.gs`, select everything, delete it, and paste in the new `apps-script/Code.gs`. Save (Ctrl+S).
2. In the function drop-down choose **setupStage3** and click **Run**.
   - Google asks for permission again, because the diary can now send emails and run a monthly job. Choose the club account → **Advanced** → **Go to Club Diary (unsafe)** → **Allow**.
   - The log should say "Stage 3 ready" and how many emails are left today.
   - It adds three columns to the end of the **Bookings** tab (Session, Bar cover event ID, Reason), adds **Committee page link** and **Privacy contact** rows to **Settings**, and creates the monthly clean-up job. Running it twice does no harm.
3. Redeploy: **Deploy** → **Manage deployments** → pencil → Version: **New version** → **Deploy**. Never "New deployment".
4. Check `<exec-url>?action=ping` still shows `{"ok":true,...}`.
5. Check `<exec-url>?action=public&from=2026-11-01&to=2026-11-30` shows `roomTaken` and `rules`.
6. In the **Settings** tab, check:
   - **Notification emails**: every committee address, separated by commas.
   - **Hire terms link**: leave blank until the terms are agreed. Blank means the confirmation email says "The club will send you the hire terms".
   - **Reply-to email**: the address customers should reply to. Blank means replies go to the club Gmail.
   - **Room capacity**: 75 at the time. From step 11 the limit is 80. It can be lowered but never raised.
   - **Privacy contact**: an email address or phone number people can use to ask about their personal data. It is shown on the booking form. Blank means the form says "contact the club".
7. Send yourself a test request from the public page, approve it on the committee page, then cancel it. You should get three emails, and the committee addresses one alert.

**The monthly clean-up job** (`purgeOldContacts`) runs on the 1st of each month at about 3am. It blanks the name, email, phone, message and reason on every booking whose date was more than 6 months ago, and on every declined request 30 days after it was declined. You can see it under **Triggers** (the alarm clock icon). If it ever goes missing, run **setupStage3** again.

**Email limit:** a free Google account can send to about 100 people a day. A request uses 1 for the customer plus 1 for each committee address. Approve, decline and cancel use 1 each.
- When fewer than 30 emails are left for the day, the website stops taking new requests and says "We can't take online requests right now. Please ring the club." That keeps emails back for approving, declining and cancelling.
- If an email still can't be sent, the action is saved, the committee page shows a red **Needs attention: emails not sent** box for 14 days, and the Change log gets a "Needs attention" row. Phone or email that customer yourself.

**If the form is flooded** (someone sends lots of fake requests):
- It looks like many requests in Needs approval with made-up names, or the website saying "We've had a lot of requests today" or "We can't take online requests right now".
- Nothing is booked by a fake request, and the calendar is not touched. Decline the fake ones without a reason, or leave them. The monthly job clears them.
- The committee can still take bookings by phone and add them to the diary as normal.
- The limits reset by themselves within 6 hours (the email allowance resets daily). Nothing needs switching off.

## 10. Tea room update

Do this **after** Pete has said the tea room can go live. Signed in as the club account. About 10 minutes. Do the steps in this order: the Apps Script first, the web pages second.

1. Open the **Club Diary Admin** sheet, **Bookings** tab. Look at **column S** (the 19th column). It should be empty. If anyone has typed anything in it, move that somewhere else first, because the diary now uses column S for the room.
2. Open the **Club Diary** Apps Script project. In `Code.gs`, select everything, delete it, and paste in the new `apps-script/Code.gs`. Save (Ctrl+S).
3. **Required, do not skip:** in the function drop-down choose **setupStage3** and click **Run**. Do this before redeploying in step 4.
   - The log should say "Stage 3 and tea room ready. Bookings columns: 19". If it doesn't, stop and tell Pete.
   - It puts the heading **Room** in column S of the Bookings tab and adds a **Tea room capacity** row (75) to the Settings tab. Existing bookings are not changed. Their Room cell stays blank, and blank means the function room.
   - Running it twice does no harm. Google should not ask for new permissions. If it does, allow them as before.
   - Afterwards, only ever type **Function room**, **Tea room** or nothing in the Room column. Anything else stops that booking being approved or cancelled until it is corrected ("Room not recognised"), and it counts as using both rooms in clash warnings.
4. Redeploy: **Deploy** → **Manage deployments** → pencil → Version: **New version** → **Deploy**. Never "New deployment".
5. Check `<exec-url>?action=ping` still shows `{"ok":true,...}`.
6. Check `<exec-url>?action=public&from=2026-12-01&to=2026-12-31` shows `"taken":{"fn":` and `"tea":`, and `"rooms"`.
7. Only now publish the new web pages (merge the `tea-room` branch into `main` and push). GitHub Pages takes about 10 minutes. Then hard refresh both pages (Ctrl+F5, or close and reopen the tab on a phone).
8. Ask the committee to reopen the diary on their phones before they edit anything. This is a precaution. The new Apps Script keeps an item's tea room tick if it is saved from an old copy of the page, but only the new page shows that tick.
9. Test: on the public page, request the **tea room** for an evening that already has a function room booking. Approve it on the committee page, check the diary shows "Private party (tea room)" and a bar cover reminder, then cancel it. You should get three emails that all say "tea room".

**Tea room capacity** in the Settings tab: 75 at the time. From step 11 the limit is 50. It can be lowered but never raised. **Room capacity** is still the function room.

## 11. Payments, new room limits and the hire terms page

Do this **after** Pete has said payments can go live. About 30 minutes. Do the steps in this order.

**What it costs:** Stripe has no monthly fee. It takes a fee from each payment (for a standard UK card about 1.5% plus 20p, so roughly 98p of each £52). If you refund someone, Stripe does not give that fee back. Check the current fees on Stripe's pricing page before you start.

### A. Make the £52 Payment Link in Stripe (signed in to the club's Stripe account)

1. At the top of the Stripe Dashboard, make sure **Test mode** is **off**. A test link starts `https://buy.stripe.com/test_` and the diary will ignore it.
2. Go to **Payment Links** and click **+ New** (or **Create payment link**).
3. Choose **Products or subscriptions**, then **+ Add a new product**:
   - Name: **Room hire, Elsecar Sports & Social Club**
   - Description: **Hire of the function room or tea room. Fee for one booking.**
   - Price: a **fixed price** of **£52.00**, **GBP**, **One off** (not recurring). Do not choose "customers choose what to pay".
4. Leave **Let customers adjust quantity** switched **off**, so it is always one booking at £52.
5. Under **Options** (or **Advanced options**):
   - **Collect customers' names**: leave **off**. Payments are matched by the booking reference and email, not by name.
   - **Require customers to provide a phone number**: optional. Off is fine, because the club already has it from the request.
   - **Allow promotion codes**: **off**.
   - **Collect customers' addresses**: off.
   - **Add custom fields**: none. The booking reference is added to each customer's link by the diary.
   - **Limit the number of payments**: off.
   - Stripe always asks for an email address.
6. Under **After payment**, choose **Show confirmation page** and add this message: `Thank you. Your room hire fee for Elsecar Sports & Social Club is paid. Keep your receipt email.`
7. Click **Create link**. Copy the link. It looks like `https://buy.stripe.com/` followed by letters and numbers.
8. Stripe **Settings** → **Customer emails**: switch on **Successful payments** so every customer gets a receipt. Switch on **Refunds** too, so they are told when a refund is made.
9. Stripe **Settings** → **Public details** (business details): set the **support email** to the same address as **Reply-to email** in the diary's Settings tab, so customers who reply to a Stripe receipt reach the club.
10. Keep the link out of GitHub, chats and the website. It goes only in the Settings tab. It is not a secret (customers see it), but anyone with it could pay against a made up reference, which is why the committee always check the reference **and** the email (see COMMITTEE-GUIDE.md, section 8).

### B. The Apps Script (signed in as the club account)

1. Open the **Club Diary** Apps Script project. In `Code.gs`, select everything, delete it, and paste in the new `apps-script/Code.gs`. Save (Ctrl+S).
2. In the function drop-down choose **setupPayments** and click **Run**.
   - The log should start "Payments ready." It adds a **Payment link** row to the **Settings** tab, changes **Room capacity** from 75 to **80** and **Tea room capacity** from 75 to **50**, and updates the notes on those rows and on **Hire terms link**. Running it again does no harm, and a lower number someone has chosen on purpose is kept.
   - Google should not ask for new permissions. If it does, allow them as before.
3. Open the **Club Diary Admin** sheet, **Settings** tab. Paste the Stripe link into **Payment link**, column B. Paste only the link, with nothing before or after it.
4. Back in Apps Script, run **setupPayments** once more. The last log line should say "Payment link in use:" and your link. If it says "No payment link in use yet", the link is blank, is a test link, or has something extra on it. Paste it again.
5. Redeploy: **Deploy** → **Manage deployments** → pencil → Version: **New version** → **Deploy**. Never "New deployment".
6. Check `<exec-url>?action=ping` still shows `{"ok":true,...}`.
7. Check `<exec-url>?action=public&from=2026-12-01&to=2026-12-31` shows `"capacity":80` for the function room and `"capacity":50` for the tea room.

### C. The web pages

1. Only now publish the new pages (merge the `payments` branch into `main` and push). GitHub Pages takes about 10 minutes. Then hard refresh (Ctrl+F5, or close and reopen the tab on a phone).
2. Open `https://peterpan6604.github.io/elsecar-diary/hire-terms.html`. Check it loads on your phone. Anything still to be confirmed shows in amber.
3. Paste that address into **Hire terms link** in the **Settings** tab. It then shows on the request form and in every confirmation email.
4. Ask the committee to reopen the diary on their phones, so they get the new **Cancel booking** box. Until they do, Cancel booking on an old copy of the page says "Please refresh the committee page and try again." Nothing is cancelled.
5. Look at **Needs approval** for **tea room** requests for **51 to 75 guests** (sent before the limit changed). They can no longer be approved. Contact those customers: offer the function room, or ask them to cut their numbers (then change Guests in the Bookings tab and approve), or decline.

### D. Test it

1. On the public page, check the form says **Hire is £52** and the rooms say up to **80** and up to **50** people.
2. Send yourself a request. The acknowledgement email should mention the £52 and say you pay nothing now.
3. Approve it on the committee page. The confirmation email should have a pay by date, a `buy.stripe.com` link ending in `?client_reference_id=ECC-...`, the hire terms link and the refund rules.
4. Click the link. Stripe should show **£52.00**. You can stop there, or pay and then refund yourself in Stripe (Stripe keeps its fee, about 98p).
5. Cancel the booking and choose **The customer asked to cancel**. Check the email gives the right refund for the date.

**If anything goes wrong with the Payment link:** clear the **Payment link** cell. Confirmation emails then say "The club will be in touch about how to pay it", and nothing else changes.

**Bookings approved before this update** got the old email with no payment link. Contact those customers yourself about the £52, or decide not to charge them.

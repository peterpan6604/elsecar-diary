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
- **Room capacity:** already set to 75
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
   - It adds three columns to the end of the **Bookings** tab (Session, Bar cover event ID, Reason), adds a **Committee page link** row to **Settings**, and creates the monthly clean-up job. Running it twice does no harm.
3. Redeploy: **Deploy** → **Manage deployments** → pencil → Version: **New version** → **Deploy**. Never "New deployment".
4. Check `<exec-url>?action=ping` still shows `{"ok":true,...}`.
5. Check `<exec-url>?action=public&from=2026-11-01&to=2026-11-30` shows `roomTaken` and `rules`.
6. In the **Settings** tab, check:
   - **Notification emails**: every committee address, separated by commas.
   - **Hire terms link**: leave blank until the terms are agreed. Blank means the confirmation email says "The club will send you the hire terms".
   - **Reply-to email**: the address customers should reply to. Blank means replies go to the club Gmail.
   - **Room capacity**: 75. It can be lowered but never raised above 75.
7. Send yourself a test request from the public page, approve it on the committee page, then cancel it. You should get three emails, and the committee addresses one alert.

**The monthly clean-up job** (`purgeOldContacts`) runs on the 1st of each month at about 3am. It blanks the name, email, phone, message and reason on every booking whose date was more than 6 months ago. You can see it under **Triggers** (the alarm clock icon). If it ever goes missing, run **setupStage3** again.

**Email limit:** a free Google account can send to about 100 people a day. A request uses 1 for the customer plus 1 for each committee address. Approve, decline and cancel use 1 each. If the limit is reached, the request is still saved and shows on the committee page, but the emails are skipped. Phone the customer in that case.

/**
 * Elsecar Club Diary: Apps Script backend
 * Stage 1 (plus small stage 2 additions: room tick, phone calendar link): committee sign-in, diary read/add/edit/delete, change log, public read.
 * Stage 3: public function room booking requests, committee approve / decline / cancel, emails, monthly clean-up of contact details.
 *
 * Runs on the elsecarsportsandsocialclub1854 Google account.
 * Private settings live in Project Settings → Script Properties:
 *   DIARY_CODE    the shared committee code (add by hand, 6+ characters)
 *   CALENDAR_ID, SHEET_ID, TOKEN_SECRET   filled in by setup()
 * After pasting a new version, run setupStage3() once from the editor (see SETUP.md).
 */

const TZ = 'Europe/London';
const CATS = ['room', 'club', 'cricket', 'meet', 'staff'];
const TOKEN_DAYS = 30;
const MAX_RANGE_DAYS = 100;
const LOCK_AFTER = 5;          // wrong codes per device before lockout
const GLOBAL_FAIL_LIMIT = 30;  // wrong codes club-wide before lockout
const LOCK_MINUTES = 15;
const PUBLIC_CACHE_SECONDS = 300;

/* Stage 3: function room booking requests */
const SESSIONS = {
  aft: { label: 'Afternoon', time: '12pm to 5pm',      start: '12:00', end: '17:00' },
  eve: { label: 'Evening',   time: '6pm to midnight',  start: '18:00', end: '00:00' },
  day: { label: 'Whole day', time: '12pm to midnight', start: '12:00', end: '00:00' }
};
const EVENT_TYPES = ['Birthday party', '18th birthday', '21st birthday', 'Wedding or engagement', 'Christening',
  'Funeral wake', 'Anniversary', 'Meeting or class', 'Other'];
const SHORT_NOTICE_TYPE = 'Funeral wake';
const MIN_NOTICE_DAYS = 7;
const MAX_AHEAD_MONTHS = 12;
const MAX_GUESTS = 75;            // fire limit. The Settings tab can only lower it.
const REQ_PER_DEVICE = 3;         // requests per device every 6 hours
const REQ_CLUB_WIDE = 20;         // requests across the whole club every 6 hours
const REQ_WINDOW_SECONDS = 21600; // 6 hours, the longest CacheService keeps anything
const PENDING_PER_EMAIL = 2;      // open requests allowed per email address
const KEEP_CONTACT_MONTHS = 6;
const KEEP_DECLINED_DAYS = 30;    // contact details on a declined request go sooner
const QUOTA_RESERVE = 30;         // emails kept back each day for approve, decline and cancel
const ATTENTION = 'Needs attention';
const REMOVED = '(removed)';
// Bookings tab columns. 1 to 15 were created by setup() in stage 1. 16 to 18 are added by setupStage3().
const BK = { id: 1, received: 2, status: 3, date: 4, start: 5, end: 6, type: 7, guests: 8, name: 9, email: 10,
  phone: 11, notes: 12, by: 13, at: 14, cal: 15, sess: 16, bar: 17, reason: 18 };
const BK_COLS = 18;
const BK_HEADERS = ['Booking ID', 'Received', 'Status', 'Date', 'Start', 'End', 'Event type', 'Guests',
  'Name', 'Email', 'Phone', 'Notes', 'Decided by', 'Decided at', 'Calendar event ID',
  'Session', 'Bar cover event ID', 'Reason'];

/* ============ One-off setup (run from the editor) ============ */

function setup() {
  const p = props_();
  if (!p.getProperty('CALENDAR_ID')) {
    const cal = CalendarApp.createCalendar('Club Diary', { timeZone: TZ });
    p.setProperty('CALENDAR_ID', cal.getId());
  }
  if (!p.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create('Club Diary Admin');
    const log = ss.getSheets()[0].setName('Change log');
    log.appendRow(['When', 'Who', 'What', 'Item', 'Item date']);
    log.setFrozenRows(1);

    const bookings = ss.insertSheet('Bookings');
    bookings.appendRow(BK_HEADERS);
    bookings.setFrozenRows(1);

    const set = ss.insertSheet('Settings');
    set.getRange(1, 1, 5, 3).setValues([
      ['Setting', 'Value', 'Notes'],
      ['Notification emails', '', 'Every committee email that should get booking alerts, separated by commas'],
      ['Room capacity', '75', 'Shown on the booking form'],
      ['Hire terms link', '', 'Web link to the function room hire terms'],
      ['Reply-to email', '', 'Address customers reply to']
    ]);
    set.setFrozenRows(1);
    set.autoResizeColumns(1, 3);
    p.setProperty('SHEET_ID', ss.getId());
  }
  if (!p.getProperty('TOKEN_SECRET')) {
    p.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  Logger.log('Calendar ID: ' + p.getProperty('CALENDAR_ID'));
  Logger.log('Admin sheet: https://docs.google.com/spreadsheets/d/' + p.getProperty('SHEET_ID'));
  if (!p.getProperty('DIARY_CODE')) {
    Logger.log('NEXT: add DIARY_CODE in Project Settings → Script Properties.');
  }
}

/** Creates, reads and deletes a test event to prove permissions work. */
function testSelf() {
  const who = { name: 'Setup test' };
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 864e5), TZ, 'yyyy-MM-dd');
  const saved = saveEvent_({ title: 'Test event', cat: 'club', date: tomorrow, start: '19:00', end: '20:00', notes: 'Delete me', pub: true }, who);
  Logger.log('Saved: ' + JSON.stringify(saved.event));
  const pub = publicEvents_(tomorrow, tomorrow);
  Logger.log('Public view sees: ' + JSON.stringify(pub.events));
  deleteEvent_(saved.event.id, who);
  Logger.log('Deleted. Check the Change log tab for two rows. Setup works.');
}

/**
 * Stage 3 upgrade. Safe to run more than once.
 * Adds the three new Bookings columns (keeps the 15 existing ones and any rows), adds the
 * "Committee page link" setting, and creates the monthly clean-up trigger.
 */
function setupStage3() {
  const sh = sheet_('Bookings');
  if (sh.getMaxColumns() < BK_COLS) sh.insertColumnsAfter(sh.getMaxColumns(), BK_COLS - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, BK_COLS).getValues()[0];
  BK_HEADERS.forEach((t, i) => { if (!head[i]) sh.getRange(1, i + 1).setValue(t); });
  sh.getRange(1, 1, sh.getMaxRows(), BK_COLS).setNumberFormat('@'); // plain text, so dates and phone numbers stay as typed

  const set = sheet_('Settings');
  const names = set.getRange(1, 1, Math.max(1, set.getLastRow()), 1).getValues().map(r => String(r[0]).trim());
  if (names.indexOf('Committee page link') < 0) {
    set.appendRow(['Committee page link', 'https://peterpan6604.github.io/elsecar-diary/committee.html',
      'Put in the booking alert emails so the committee can open the diary']);
  }
  if (names.indexOf('Privacy contact') < 0) {
    set.appendRow(['Privacy contact', '', 'Email or phone for questions about personal data. Shown on the booking form. Blank means "contact the club"']);
  }

  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'purgeOldContacts');
  if (!has) ScriptApp.newTrigger('purgeOldContacts').timeBased().onMonthDay(1).atHour(3).create();
  Logger.log('Stage 3 ready. Bookings columns: ' + BK_COLS + '. Monthly clean-up trigger: ' + (has ? 'already there' : 'created') + '.');
  Logger.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
}

/* ============ Web entry points ============ */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.action === 'ping') return json_({ ok: true, time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss') });
    if (p.action === 'public') return json_(publicEvents_(p.from, p.to));
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_(errorOut_(err));
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'login') return json_(login_(body));
    if (body.action === 'request') return json_(requestBooking_(body)); // public: anyone can send a request

    const user = auth_(body.token);
    switch (body.action) {
      case 'check':  return json_({ ok: true, name: user.name, feed: props_().getProperty('FEED_URL') || '' });
      case 'list':   return json_(listEvents_(body.from, body.to));
      case 'save':   return json_(saveEvent_(body.event, user));
      case 'delete': return json_(deleteEvent_(body.id, user));
      case 'log':    return json_(recentLog_());
      case 'bookings': return json_(listBookings_());
      case 'approve':  return json_(approveBooking_(body.id, user));
      case 'decline':  return json_(declineBooking_(body.id, body.reason, user));
      case 'cancel':   return json_(cancelBooking_(body.id, body.reason, user));
    }
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_(errorOut_(err));
  }
}

/* ============ Sign-in ============ */

function login_(b) {
  const name = cleanStr_(b.name, 40);
  if (!name) fail_('Add your first name so changes show who made them.');

  const cache = CacheService.getScriptCache();
  const deviceKey = 'fail:' + (cleanStr_(b.deviceId, 64) || 'unknown');
  const globalKey = 'fail:all';
  // Read and bump the wrong-code counters inside the lock, so a burst of guesses can't slip past the limit
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const deviceFails = Number(cache.get(deviceKey) || 0);
    const globalFails = Number(cache.get(globalKey) || 0);
    if (deviceFails >= LOCK_AFTER || globalFails >= GLOBAL_FAIL_LIMIT) {
      fail_('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
    }
    if (!safeEqual_(String(b.code || '').trim(), prop_('DIARY_CODE'))) {
      cache.put(deviceKey, String(deviceFails + 1), LOCK_MINUTES * 60);
      cache.put(globalKey, String(globalFails + 1), LOCK_MINUTES * 60);
      fail_("That code isn't right. Check with the club secretary.");
    }
    cache.remove(deviceKey);
  } finally {
    lock.releaseLock();
  }

  const exp = Date.now() + TOKEN_DAYS * 864e5;
  return { ok: true, token: makeToken_({ n: name, exp: exp, v: codeVersion_() }), name: name, expires: exp };
}

function makeToken_(payload) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  return body + '.' + sign_(body);
}

function auth_(token) {
  const parts = String(token || '').split('.');
  const again = () => fail_('Please enter the diary code again.', { auth: true });
  if (parts.length !== 2 || !safeEqual_(sign_(parts[0]), parts[1])) again();
  let p;
  try {
    p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { again(); }
  // Expired, or the code has been changed since this person signed in
  if (!p || p.exp < Date.now() || p.v !== codeVersion_()) again();
  return { name: p.n };
}

function sign_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, prop_('TOKEN_SECRET')));
}

function codeVersion_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, prop_('DIARY_CODE') + prop_('TOKEN_SECRET'));
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/* ============ Diary ============ */

function publicEvents_(from, to) {
  const range = parseRange_(from, to);
  const cache = CacheService.getScriptCache();
  const key = 'pub:' + (cache.get('ver') || '0') + ':' + from + ':' + to;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const events = [];
  const uses = [];
  cal_().getEvents(range[0], range[1]).forEach(ev => {
    const x = shape_(ev, false);
    if (x.cat === 'room') {
      events.push({ date: x.date, start: x.start, end: x.end, allDay: x.allDay, cat: 'room', title: 'Private party' });
    } else if (ev.getTag('pub') === '1') {
      events.push({ date: x.date, start: x.start, end: x.end, allDay: x.allDay, cat: x.cat, title: x.title });
    }
    // Room hire, and any committee item ticked "Uses the function room" (public or not), takes its session.
    // Pending requests are NOT counted: only approved bookings block a session publicly.
    if (usesRoom_(ev, x)) uses.push({ date: x.date, sess: sessionOfTimes_(x.start, x.end) });
  });
  const out = { ok: true, events: events, roomTaken: takenSessions_(uses), rules: publicRules_() };
  cache.put(key, JSON.stringify(out), PUBLIC_CACHE_SECONDS);
  return out;
}

function listEvents_(from, to) {
  const range = parseRange_(from, to);
  const events = cal_().getEvents(range[0], range[1]).map(ev => shape_(ev, true));
  return { ok: true, events: events };
}

function saveEvent_(x, user) {
  x = x || {};
  const title = cleanStr_(x.title, 100);
  if (!title) fail_('Give it a name so people know what it is.');
  if (CATS.indexOf(x.cat) < 0) fail_('Choose a type for this item.');
  if (!isDate_(x.date)) fail_('Choose a date.');
  if (!isTime_(x.start) || !isTime_(x.end)) fail_('Add a start and finish time.');
  const notes = cleanStr_(x.notes, 1000, true);
  const pub = x.cat === 'room' ? true : !!x.pub; // room hire always shows publicly, as "Private party"

  const start = toDate_(x.date, x.start);
  const end = toDate_(x.date, x.end);
  if (end <= start) end.setDate(end.getDate() + 1); // finishes after midnight

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let ev;
    if (x.id) {
      ev = cal_().getEventById(String(x.id));
      if (!ev) fail_('Someone else has deleted this item.');
      if (ev.getTag('src') === 'play-cricket') fail_('Fixtures come from Play-Cricket. Change them there.');
      if (ev.getTag('bk')) fail_(BOOKING_LOCKED);
    }
    // A committee item that uses the room must not land on a customer's approved booking
    if (x.cat === 'room' || x.room) {
      const mine = sessionOfTimes_(x.start, x.end);
      const hit = bookingEventsOn_(x.date).find(u => sessionsClash_(u.sess, mine));
      if (hit) {
        fail_('A customer has booked the function room that ' + SESSIONS[hit.sess].label.toLowerCase() + ' (' + hit.ref +
          '). Untick "Uses the function room", or cancel that booking first.');
      }
    }
    if (x.id) {
      ev.setTitle(title);
      ev.setTime(start, end);
      ev.setDescription(notes);
    } else {
      ev = cal_().createEvent(title, start, end, { description: notes });
    }
    ev.setTag('cat', x.cat);
    ev.setTag('pub', pub ? '1' : '0');
    ev.setTag('room', (x.cat === 'room' || x.room) ? '1' : '0'); // "Uses the function room" tick
    ev.setTag('by', user.name);
    bumpCache_();
    log_(user.name, x.id ? 'Edited' : 'Added', title, x.date);
    return { ok: true, event: shape_(ev, true) };
  } finally {
    lock.releaseLock();
  }
}

function deleteEvent_(id, user) {
  const ev = cal_().getEventById(String(id || ''));
  if (!ev) fail_('Someone else has already deleted this item.');
  if (ev.getTag('src') === 'play-cricket') fail_('Fixtures come from Play-Cricket. Change them there.');
  if (ev.getTag('bk')) fail_(BOOKING_LOCKED);
  const title = ev.getTitle();
  const date = Utilities.formatDate(ev.getStartTime(), TZ, 'yyyy-MM-dd');
  ev.deleteEvent();
  bumpCache_();
  log_(user.name, 'Deleted', title, date);
  return { ok: true };
}

function shape_(ev, full) {
  const s = ev.getStartTime();
  const e = ev.getEndTime();
  const allDay = ev.isAllDayEvent();
  const tagCat = ev.getTag('cat');
  const o = {
    id: ev.getId(),
    date: Utilities.formatDate(s, TZ, 'yyyy-MM-dd'),
    start: allDay ? '' : Utilities.formatDate(s, TZ, 'HH:mm'),
    end: allDay ? '' : Utilities.formatDate(e, TZ, 'HH:mm'),
    allDay: allDay,
    // Untagged events (added straight into Google Calendar) count as committee-only club events
    cat: CATS.indexOf(tagCat) >= 0 ? tagCat : 'club',
    title: ev.getTitle(),
    src: ev.getTag('src') || '',
    status: 'confirmed'
  };
  if (full) {
    o.notes = ev.getDescription() || '';
    o.pub = ev.getTag('pub') === '1';
    o.room = o.cat === 'room' || ev.getTag('room') === '1';
    o.by = ev.getTag('by') || '';
    o.bk = ev.getTag('bk') || ''; // set on an approved online booking's "Private party" event
  }
  return o;
}

const BOOKING_LOCKED = 'This is an online booking. To cancel it, use Cancel in the Function room bookings card so the customer is told.';

function usesRoom_(ev, x) { return x.cat === 'room' || ev.getTag('room') === '1'; }

/* ============ Function room booking requests (stage 3) ============ */
// Request and approve (decided 7 Nov 2026). A request is saved as Pending and never blocks a session publicly.
// Only an approved booking (a "Private party" calendar event) takes the session.
// Customer contact details live only in the Bookings tab, never in the calendar or the committee alert email.

const CLUB_NAME = 'Elsecar Sports & Social Club';

/** Public: a customer asks for a session. */
function requestBooking_(b) {
  b = b || {};
  // Hidden spam field filled in, or the form sent faster than a person could. Pretend it worked so bots learn nothing.
  if (cleanStr_(b.website, 200) || !(Number(b.elapsed) >= 3000)) return { ok: true, ref: '' };

  const cache = CacheService.getScriptCache();
  const devKey = 'req:' + (cleanStr_(b.deviceId, 64) || 'unknown');
  const devCount = Number(cache.get(devKey) || 0);
  const allCount = Number(cache.get('req:all') || 0);
  if (devCount >= REQ_PER_DEVICE) fail_("You've sent several requests already. The committee will be in touch.");
  if (allCount >= REQ_CLUB_WIDE) fail_("We've had a lot of requests today. Please try again tomorrow.");
  // Keep the day's email allowance for approve, decline and cancel emails
  if (MailApp.getRemainingDailyQuota() < QUOTA_RESERVE) fail_("We can't take online requests right now. Please ring the club.");

  const set = settings_();
  const today = todayIso_();
  const r = validateRequest_(b, today, capacity_(set));

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let ref, clash;
  try {
    if (!isFreeIn_(roomUsesOn_(r.date), r.date, r.sess)) {
      fail_('Sorry, the function room is already booked that ' + SESSIONS[r.sess].label.toLowerCase() + '. Please choose another date or session.');
    }
    const rows = bookingRows_();
    const mine = rows.filter(x => x.status === 'Pending' && x.date >= today && x.email.toLowerCase() === r.email.toLowerCase());
    if (mine.length >= PENDING_PER_EMAIL) fail_('You already have requests waiting for the committee. They will be in touch soon.');
    const rivals = rows.filter(x => x.status === 'Pending' && x.date === r.date && sessionsClash_(x.sess, r.sess));
    clash = rivals.length ? 'Another request is already waiting for this session.' : '';

    ref = newRef_();
    const s = SESSIONS[r.sess];
    appendBooking_({ id: ref, received: nowText_(), status: 'Pending', date: r.date, start: s.start, end: s.end,
      type: r.type, guests: String(r.guests), name: r.name, email: r.email, phone: r.phone, notes: r.message, sess: r.sess });
  } finally {
    lock.releaseLock();
  }
  cache.put(devKey, String(devCount + 1), REQ_WINDOW_SECONDS);
  cache.put('req:all', String(allCount + 1), REQ_WINDOW_SECONDS);

  // Emails: 1 to the customer, 1 alert to the committee (counts once per committee address against the daily quota).
  // The acknowledgement goes to an address nobody has checked yet, so it holds only the club's own words:
  // no name or anything else the visitor typed.
  const sent = sendMail_(r.email, 'Your function room request (' + ref + ')', [
    'Hello,',
    'Thank you for asking to hire the function room at ' + CLUB_NAME + '.',
    'This is a request, not a confirmed booking. The committee will look at it and be in touch. Please do not make firm plans until you hear from us.',
    ['Date: ' + niceDate_(r.date), 'Session: ' + sessionText_(r.sess), 'Reference: ' + ref].join('\n'),
    'If you did not send this request, you can ignore this email.',
    CLUB_NAME
  ], set, 'Acknowledgement to customer (' + ref + ')', r.date);
  const committee = committeeEmails_(set);
  if (committee.length) {
    const link = committeeUrl_(set);
    sendMail_(committee.join(','), 'Function room request: ' + niceDate_(r.date) + ', ' + SESSIONS[r.sess].label.toLowerCase() + ' (' + ref + ')', [
      'A new function room request has come in from the website.',
      detailLines_(r.date, r.sess, r.type, r.guests, ref),
      clash ? 'Clash: ' + clash : '',
      'Sign in to the club diary to see the contact details, then approve or decline it.' + (link ? '\n' + link : ''),
      'It is not a booking until a committee member approves it.'
    ], null, 'Committee alert (' + ref + ')', r.date);
  } else {
    needsAttention_('No committee emails in Settings, so nobody was alerted (' + ref + ')', r.date);
  }
  return { ok: true, ref: ref, emailed: sent };
}

/** Committee: requests waiting for a decision (past dates too, so every customer gets a reply),
 *  approved bookings still to come, and recent emails that failed. Contact details only here. */
function listBookings_() {
  const today = todayIso_();
  const rows = bookingRows_().filter(x => x.name !== REMOVED);
  const pending = rows.filter(x => x.status === 'Pending' && isRealDate_(x.date)).sort(byBkDate_);
  const approved = rows.filter(x => x.status === 'Approved' && x.date >= today).sort(byBkDate_);
  const future = pending.filter(x => x.date >= today);
  const uses = [];
  if (future.length) {
    const a = toDate_(future[0].date, '00:00');
    const z = toDate_(future[future.length - 1].date, '00:00');
    z.setDate(z.getDate() + 1);
    cal_().getEvents(a, z).forEach(ev => {
      const x = shape_(ev, false);
      if (usesRoom_(ev, x)) uses.push({ date: x.date, sess: sessionOfTimes_(x.start, x.end), title: x.cat === 'room' ? 'a booking' : x.title });
    });
  }
  return {
    ok: true,
    pending: pending.map(p => Object.assign(bkOut_(p), p.date < today ? { past: true, clash: '' } : { clash: clashNote_(p, future, uses) })),
    upcoming: approved.map(bkOut_),
    attention: recentAttention_()
  };
}

function approveBooking_(id, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let b;
  try {
    const rows = bookingRows_();
    b = findBooking_(rows, id);
    if (b.status !== 'Pending') fail_('This request has already been ' + b.status.toLowerCase() + '.');
    if (b.date < todayIso_()) fail_('The date of this request has passed. Decline it instead.');
    const busy = 'The function room is no longer free that ' + SESSIONS[b.sess].label.toLowerCase() + '. Decline this request, or cancel the other booking first.';
    if (!isFreeIn_(roomUsesOn_(b.date), b.date, b.sess)) fail_(busy);
    if (rows.some(x => x.status === 'Approved' && x.id !== b.id && x.date === b.date && sessionsClash_(x.sess, b.sess))) fail_(busy);

    const s = SESSIONS[b.sess];
    const start = toDate_(b.date, s.start);
    const end = toDate_(b.date, s.end);
    if (end <= start) end.setDate(end.getDate() + 1); // evening runs to midnight
    let ev = null, bar = null;
    try {
      // No names, emails or phone numbers in the calendar: committee phones subscribe to it.
      ev = cal_().createEvent('Private party', start, end,
        { description: 'Online booking ' + b.id + '. ' + b.type + ', ' + b.guests + ' guests. Contact details are on the committee page.' });
      ev.setTag('cat', 'room'); ev.setTag('pub', '1'); ev.setTag('room', '1'); ev.setTag('by', user.name); ev.setTag('bk', b.id);
      bar = cal_().createEvent('Bar cover needed: private party', start, end,
        { description: 'Bar cover for online booking ' + b.id + ' (' + b.guests + ' guests).' });
      bar.setTag('cat', 'staff'); bar.setTag('pub', '0'); bar.setTag('room', '0'); bar.setTag('by', user.name); bar.setTag('bar', b.id);
      updateBooking_(b, { status: 'Approved', by: user.name, at: nowText_(), cal: ev.getId(), bar: bar.getId() });
    } catch (err) {
      // Don't leave a "Private party" in the diary that the Bookings tab knows nothing about
      [bar, ev].forEach(x => { try { if (x) x.deleteEvent(); } catch (e) { /* already gone */ } });
      throw err;
    }
    bumpCache_();
    log_(user.name, 'Approved booking', b.type + ' (' + b.id + ')', b.date);
  } finally {
    lock.releaseLock();
  }
  const set = settings_();
  const terms = termsUrl_(set);
  const sent = sendMail_(b.email, 'Your function room booking is confirmed (' + b.id + ')', [
    'Hello ' + b.name + ',',
    'Good news. Your function room booking at ' + CLUB_NAME + ' is confirmed.',
    detailLines_(b.date, b.sess, b.type, b.guests, b.id),
    terms ? 'Please read the hire terms before your event:\n' + terms : 'The club will send you the hire terms before your event.',
    'If you need to change or cancel, please tell us as soon as you can by replying to this email.',
    CLUB_NAME
  ], set, 'Confirmation to customer (' + b.id + ')', b.date);
  return { ok: true, emailed: sent };
}

function declineBooking_(id, reason, user) {
  const why = cleanStr_(reason, 500, true);
  const b = decide_(id, 'Pending', { status: 'Declined', reason: why }, user, 'Declined request');
  const sent = sendMail_(b.email, 'Your function room request (' + b.id + ')', [
    'Hello ' + b.name + ',',
    'Thank you for your request. Sorry, the club cannot take your booking for the function room on ' + niceDate_(b.date) + ' (' + sessionText_(b.sess) + ').',
    why ? 'The committee said: ' + why : '',
    'You are welcome to send a request for another date.',
    CLUB_NAME
  ], settings_(), 'Decline to customer (' + b.id + ')', b.date);
  return { ok: true, emailed: sent };
}

function cancelBooking_(id, reason, user) {
  const why = cleanStr_(reason, 500, true);
  if (why.length < 3) fail_('Add a reason. It goes in the email to the customer.');
  const b = decide_(id, 'Approved', { status: 'Cancelled', reason: why }, user, 'Cancelled booking', true);
  const sent = sendMail_(b.email, 'Your function room booking has been cancelled (' + b.id + ')', [
    'Hello ' + b.name + ',',
    'Sorry, the club has had to cancel your function room booking on ' + niceDate_(b.date) + ' (' + sessionText_(b.sess) + ').',
    'Reason: ' + why,
    'We are sorry for the trouble this causes. Please reply to this email if you have any questions.',
    CLUB_NAME
  ], settings_(), 'Cancellation to customer (' + b.id + ')', b.date);
  return { ok: true, emailed: sent };
}

/** Shared by decline and cancel: checks the status, removes calendar events if asked, updates the row. */
function decide_(id, mustBe, change, user, logWhat, removeEvents) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const b = findBooking_(bookingRows_(), id);
    if (b.status !== mustBe) fail_('This ' + (mustBe === 'Pending' ? 'request' : 'booking') + ' is already ' + b.status.toLowerCase() + '.');
    if (removeEvents) {
      [b.cal, b.bar].forEach(evId => {
        if (!evId) return;
        try { const ev = cal_().getEventById(evId); if (ev) ev.deleteEvent(); } catch (e) { /* already gone */ }
      });
      bumpCache_();
    }
    updateBooking_(b, Object.assign({ by: user.name, at: nowText_() }, change));
    log_(user.name, logWhat, b.type + ' (' + b.id + ')', b.date);
    return b;
  } finally {
    lock.releaseLock();
  }
}

/** Monthly job (trigger made by setupStage3): removes customer contact details
 *  6 months after the event, or 30 days after a request was declined. */
function purgeOldContacts() {
  const today = todayIso_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let n = 0;
  try {
    bookingRows_().forEach(b => {
      if (b.name === REMOVED || !purgeDue_(b, today)) return;
      updateBooking_(b, { name: REMOVED, email: '', phone: '', notes: '', reason: '' });
      n++;
    });
  } finally {
    lock.releaseLock();
  }
  Logger.log('Removed contact details from ' + n + ' booking(s).');
}

/* ---- Bookings tab ---- */

function bookingRows_() {
  const sh = sheet_('Bookings');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, BK_COLS).getValues().map((r, i) => {
    const o = { row: i + 2 };
    Object.keys(BK).forEach(k => { o[k] = cellText_(r[BK[k] - 1]); });
    o.sess = sessKey_(o.sess, o.start, o.end);
    return o;
  });
}

function findBooking_(rows, id) {
  const want = String(id || '');
  if (!/^ECC-[A-Z0-9]{6}$/.test(want)) fail_('That booking was not found.');
  const b = rows.find(x => x.id === want);
  if (!b) fail_('That booking was not found.');
  return b;
}

/** One row of cell values, every one guarded against formulas. Session is stored as its label ("Evening"). */
function bookingRowValues_(o) {
  const row = new Array(BK_COLS).fill('');
  Object.keys(BK).forEach(k => {
    let v = o[k] == null ? '' : o[k];
    if (k === 'sess' && SESSIONS[v]) v = SESSIONS[v].label;
    row[BK[k] - 1] = safeCell_(v);
  });
  return row;
}

function appendBooking_(vals) {
  const sh = sheet_('Bookings');
  // Plain text format first, so Sheets keeps dates, times and phone numbers exactly as written
  sh.getRange(sh.getLastRow() + 1, 1, 1, BK_COLS).setNumberFormat('@').setValues([bookingRowValues_(vals)]);
}

/** Rewrites one booking row in a single write. Only call it inside the script lock, with a row just read. */
function updateBooking_(b, vals) {
  sheet_('Bookings').getRange(b.row, 1, 1, BK_COLS).setNumberFormat('@').setValues([bookingRowValues_(Object.assign({}, b, vals))]);
}

/** What the committee page gets for one booking. */
function bkOut_(b) {
  return { id: b.id, received: b.received, date: b.date, sess: b.sess, type: b.type, guests: b.guests,
    name: b.name, email: b.email, phone: b.phone, message: b.notes, by: b.by, at: b.at };
}

function byBkDate_(a, b) { return (a.date + a.sess).localeCompare(b.date + b.sess); }

/** Every room use on one date, from the calendar: approved bookings and committee items ticked "Uses the function room". */
function roomUsesOn_(date) {
  const out = [];
  eventsOnDate_(date).forEach(ev => {
    const x = shape_(ev, false);
    if (x.date === date && usesRoom_(ev, x)) out.push({ date: date, sess: sessionOfTimes_(x.start, x.end) });
  });
  return out;
}

/** Approved online bookings on one date (their "Private party" events). */
function bookingEventsOn_(date) {
  const out = [];
  eventsOnDate_(date).forEach(ev => {
    const ref = ev.getTag('bk');
    if (!ref) return;
    const x = shape_(ev, false);
    if (x.date === date) out.push({ date: date, sess: sessionOfTimes_(x.start, x.end), ref: ref });
  });
  return out;
}

function eventsOnDate_(date) {
  const a = toDate_(date, '00:00');
  const z = toDate_(date, '00:00');
  z.setDate(z.getDate() + 1);
  return cal_().getEvents(a, z);
}

/* ---- Email ---- */

/** Sends one plain text email (never HTML, so nothing typed can become a link or markup). Returns true if sent.
 *  If it can't be sent, a "Needs attention" row goes in the Change log and shows on the committee page. */
function sendMail_(to, subject, paragraphs, set, what, date) {
  try {
    if (MailApp.getRemainingDailyQuota() < String(to).split(',').length) throw new Error('daily email limit reached');
    const opts = { to: to, subject: subject, body: paragraphs.filter(Boolean).join('\n\n'), name: CLUB_NAME };
    const replyTo = set ? replyTo_(set) : '';
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(opts);
    return true;
  } catch (e) {
    console.error('Email failed: ' + subject + ': ' + e);
    needsAttention_('Email not sent: ' + what, date);
    return false;
  }
}

/** Logs a problem the committee must deal with by hand. No contact details: the Change log is never cleaned. */
function needsAttention_(item, date) {
  try { log_('Diary', ATTENTION, item, date); } catch (e) { console.error('Could not log: ' + item); }
}

/** "Needs attention" rows from the last 14 days, newest first. */
function recentAttention_() {
  const sh = sheet_('Change log');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(200, last - 1);
  const since = addDaysIso_(todayIso_(), -14);
  return sh.getRange(last - n + 1, 1, n, 5).getValues().reverse()
    .filter(r => String(r[2]) === ATTENTION)
    .map(r => ({ when: cellText_(r[0]), item: cellText_(r[3]), date: cellText_(r[4]) }))
    .filter(x => x.when.slice(0, 10) >= since)
    .slice(0, 10);
}

function detailLines_(date, sess, type, guests, ref) {
  return ['Date: ' + niceDate_(date), 'Session: ' + sessionText_(sess), 'Type of event: ' + type,
    'Guests: ' + guests, 'Reference: ' + ref].join('\n');
}

/* ---- Settings tab ---- */

function settings_() {
  const sh = sheet_('Settings');
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => { out[String(r[0]).trim()] = String(r[1]).trim(); });
  return out;
}

/** Safe settings for the public page. Cached with the public diary. */
function publicRules_() {
  const set = settings_();
  return { today: todayIso_(), capacity: capacity_(set), termsUrl: termsUrl_(set), minNotice: MIN_NOTICE_DAYS,
    maxMonths: MAX_AHEAD_MONTHS, shortNoticeType: SHORT_NOTICE_TYPE, types: EVENT_TYPES, privacyContact: privacyContact_(set) };
}

function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowText_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function newRef_() { return 'ECC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase(); }

/** Sheets can turn text into dates. Turn any value back into plain text and undo the formula guard. */
function cellText_(v) {
  if (v instanceof Date) {
    const hasTime = v.getHours() || v.getMinutes();
    return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).replace(/^'(?=[=+\-@])/, '');
}

/* ---- Pure rules (no Google services, so tests/test-rules.js can check them) ---- */

/** Checks a request and returns clean values. Throws a plain English message on the first problem. */
function validateRequest_(b, today, capacity) {
  const name = cleanStr_(b.name, 80);
  if (name.length < 2) fail_('Add your name.');
  if (/:\/\/|www\.|[<>@]/i.test(name)) fail_('Please type just your name.');

  const phone = cleanStr_(b.phone, 25);
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9 +()\-]+$/.test(phone) || digits.length < 10 || digits.length > 15) fail_('Add a phone number we can call you on.');

  const email = cleanStr_(b.email, 120);
  if (!isEmail_(email)) fail_('Add an email address so we can reply.');

  const date = String(b.date || '');
  if (!isRealDate_(date)) fail_('Choose a date.');
  const sess = String(b.sess || '');
  if (!Object.prototype.hasOwnProperty.call(SESSIONS, sess)) fail_('Choose a session: afternoon, evening or the whole day.');
  const type = String(b.type || '');
  if (EVENT_TYPES.indexOf(type) < 0) fail_('Choose the type of event.');

  const g = String(b.guests == null ? '' : b.guests).trim();
  const guests = /^\d{1,4}$/.test(g) ? Number(g) : 0;
  if (guests < 1) fail_('Add roughly how many guests.');
  if (guests > capacity) fail_('The room holds up to ' + capacity + ' people, including staff and entertainers.');

  const message = cleanStr_(b.message, 1000, true);

  const ahead = daysBetween_(today, date);
  if (type === SHORT_NOTICE_TYPE) {
    if (ahead < 1) fail_('Funeral wakes can be requested from tomorrow onwards. For anything sooner, please ring the club.');
  } else if (ahead < MIN_NOTICE_DAYS) {
    fail_('We need at least ' + MIN_NOTICE_DAYS + " days' notice. The earliest date you can ask for is " + niceDate_(addDaysIso_(today, MIN_NOTICE_DAYS)) + '.');
  }
  if (date > addMonthsIso_(today, MAX_AHEAD_MONTHS)) fail_('We take requests up to ' + MAX_AHEAD_MONTHS + ' months ahead.');

  return { name: name, phone: phone, email: email, date: date, sess: sess, type: type, guests: guests, message: message };
}

/** Which bookable session a diary item takes, from its times: 'aft', 'eve', 'day', or '' if neither.
 *  Afternoon is 12:00 to 17:00 and Evening 18:00 to midnight, so a 09:00 to 12:00 item takes neither.
 *  Matches sessionOf() in rules.js. */
function sessionOfTimes_(start, end) {
  if (!start) return 'day'; // all day
  const mins = t => { const p = String(t || '00:00').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
  const s = mins(start);
  let e = mins(end || '00:00');
  if (e <= s) e += 1440; // finishes after midnight
  const aft = s < 17 * 60 && e > 12 * 60;
  const eve = s < 24 * 60 && e > 18 * 60;
  return aft && eve ? 'day' : aft ? 'aft' : eve ? 'eve' : '';
}

function sessionsClash_(a, b) { return !!a && !!b && (a === 'day' || b === 'day' || a === b); }

/** Is it time to remove this booking's contact details? Pure, so tests can check it. */
function purgeDue_(b, today) {
  if (b.status === 'Declined') {
    const decided = String(b.at || '').slice(0, 10);
    const when = isRealDate_(decided) ? decided : String(b.received || '').slice(0, 10);
    return !isRealDate_(when) || daysBetween_(when, today) >= KEEP_DECLINED_DAYS;
  }
  // A blank or unreadable event date falls back to the date the request came in
  const event = isRealDate_(b.date) ? b.date : String(b.received || '').slice(0, 10);
  return !isRealDate_(event) || event < addMonthsIso_(today, -KEEP_CONTACT_MONTHS);
}

/** [{date, sess}] → { '2026-11-14': ['aft', 'eve'] }. Whole day takes both. */
function takenSessions_(uses) {
  const m = {};
  uses.forEach(u => {
    const t = m[u.date] || (m[u.date] = {});
    if (u.sess === 'day') { t.aft = true; t.eve = true; } else if (u.sess) t[u.sess] = true;
  });
  const out = {};
  Object.keys(m).sort().forEach(d => { out[d] = ['aft', 'eve'].filter(s => m[d][s]); });
  return out;
}

function isFreeIn_(uses, date, sess) {
  return !uses.some(u => u.date === date && sessionsClash_(u.sess, sess));
}

/** Plain English clash warning for the committee. Empty if there is no clash. */
function clashNote_(p, pending, uses) {
  const notes = [];
  uses.filter(u => u.date === p.date && sessionsClash_(u.sess, p.sess))
    .forEach(u => notes.push('The room is already in use that day: ' + u.title + ' (' + SESSIONS[u.sess].label.toLowerCase() + ').'));
  const others = pending.filter(o => o.id !== p.id && o.date === p.date && sessionsClash_(o.sess, p.sess));
  if (others.length === 1) notes.push('Another request wants this session too (' + others[0].id + ').');
  else if (others.length > 1) notes.push(others.length + ' other requests want this session too.');
  return notes.join(' ');
}

function sessKey_(label, start, end) {
  const k = Object.keys(SESSIONS).find(x => SESSIONS[x].label === label);
  return k || (start ? sessionOfTimes_(start, end) : 'day');
}

function sessionText_(sess) { return SESSIONS[sess].label + ', ' + SESSIONS[sess].time; }

function isEmail_(s) { return /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[A-Za-z]{2,}$/.test(String(s || '')) && String(s).length <= 120; }

function committeeEmails_(set) { return String(set['Notification emails'] || '').split(/[\s,;]+/).filter(isEmail_); }
function replyTo_(set) { const v = String(set['Reply-to email'] || ''); return isEmail_(v) ? v : ''; }
function termsUrl_(set) { const v = String(set['Hire terms link'] || ''); return /^https:\/\/[^\s<>"']+$/.test(v) ? v : ''; }
function committeeUrl_(set) { const v = String(set['Committee page link'] || ''); return /^https:\/\/[^\s<>"']+$/.test(v) ? v : ''; }
function privacyContact_(set) { return cleanStr_(String(set['Privacy contact'] || '').replace(/[<>]/g, ''), 120); }
function capacity_(set) {
  const n = parseInt(set['Room capacity'], 10);
  return n >= 1 && n <= MAX_GUESTS ? n : MAX_GUESTS;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isRealDate_(s) {
  if (!isDate_(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function utcOf_(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function isoOfUtc_(t) {
  const d = new Date(t);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function daysBetween_(a, b) { return Math.round((utcOf_(b) - utcOf_(a)) / 864e5); }
function addDaysIso_(s, n) { return isoOfUtc_(utcOf_(s) + n * 864e5); }
/** Adds months, keeping to the last day of a shorter month (31 Aug minus 6 months is 28 or 29 Feb). */
function addMonthsIso_(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return isoOfUtc_(Date.UTC(y, m - 1 + n, Math.min(d, lastDay)));
}
function niceDate_(s) {
  const t = new Date(utcOf_(s));
  return DAY_NAMES[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MONTH_NAMES[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
}

/* ============ Change log ============ */

function log_(who, what, item, date) {
  sheet_('Change log').appendRow([new Date(), safeCell_(who), what, safeCell_(item), date || '']);
}

function recentLog_() {
  const sh = sheet_('Change log');
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, log: [] };
  const n = Math.min(20, last - 1);
  const rows = sh.getRange(last - n + 1, 1, n, 5).getValues().reverse();
  return {
    ok: true,
    log: rows.map(r => ({
      when: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd HH:mm') : String(r[0]),
      who: String(r[1]).replace(/^'/, ''), what: r[2], item: String(r[3]).replace(/^'/, ''),
      // Sheets turns '2026-11-13' into a real date, so turn it back into plain text
      date: r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, 'yyyy-MM-dd') : String(r[4])
    }))
  };
}

/* ============ Helpers ============ */

function props_() { return PropertiesService.getScriptProperties(); }

function prop_(k) {
  const v = props_().getProperty(k);
  if (!v) throw new Error('Missing Script Property ' + k + '. See SETUP.md.');
  return v;
}

function cal_() {
  const cal = CalendarApp.getCalendarById(prop_('CALENDAR_ID'));
  if (!cal) throw new Error('Club Diary calendar not found. Was setup() run on the club account?');
  return cal;
}

function sheet_(name) {
  return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(name);
}

function bumpCache_() {
  CacheService.getScriptCache().put('ver', String(Date.now()), 21600);
}

function parseRange_(from, to) {
  if (!isDate_(from) || !isDate_(to)) fail_('Dates must look like 2026-11-01.');
  const a = toDate_(from, '00:00');
  const b = toDate_(to, '00:00');
  b.setDate(b.getDate() + 1);
  if (b <= a || (b - a) / 864e5 > MAX_RANGE_DAYS) fail_('Choose a shorter date range.');
  return [a, b];
}

function toDate_(d, t) {
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi);
}

function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isTime_(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }

/** Trims, removes control characters and caps length. */
function cleanStr_(v, max, multiline) {
  let s = String(v == null ? '' : v);
  s = multiline ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim().slice(0, max);
}

/** Stops a value being read as a formula when written to the Sheet. */
function safeCell_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function fail_(msg, extra) {
  const e = new Error(msg);
  e.userFacing = true;
  Object.assign(e, extra || {});
  throw e;
}

function errorOut_(err) {
  if (!err.userFacing) console.error(err && err.stack || err);
  return { ok: false, error: err.userFacing ? err.message : 'Something went wrong. Try again in a minute.', auth: !!err.auth };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

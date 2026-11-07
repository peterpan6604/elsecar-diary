/**
 * Elsecar Club Diary: Apps Script backend
 * Stage 1 (plus small stage 2 additions: room tick, phone calendar link): committee sign-in, diary read/add/edit/delete, change log, public read.
 *
 * Runs on the elsecarsportsandsocialclub1854 Google account.
 * Private settings live in Project Settings → Script Properties:
 *   DIARY_CODE    the shared committee code (add by hand, 6+ characters)
 *   CALENDAR_ID, SHEET_ID, TOKEN_SECRET   filled in by setup()
 */

const TZ = 'Europe/London';
const CATS = ['room', 'club', 'cricket', 'meet', 'staff'];
const TOKEN_DAYS = 30;
const MAX_RANGE_DAYS = 100;
const LOCK_AFTER = 5;          // wrong codes per device before lockout
const GLOBAL_FAIL_LIMIT = 30;  // wrong codes club-wide before lockout
const LOCK_MINUTES = 15;
const PUBLIC_CACHE_SECONDS = 300;

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
    bookings.appendRow(['Booking ID', 'Received', 'Status', 'Date', 'Start', 'End', 'Event type', 'Guests',
      'Name', 'Email', 'Phone', 'Notes', 'Decided by', 'Decided at', 'Calendar event ID']);
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

    const user = auth_(body.token);
    switch (body.action) {
      case 'check':  return json_({ ok: true, name: user.name, feed: props_().getProperty('FEED_URL') || '' });
      case 'list':   return json_(listEvents_(body.from, body.to));
      case 'save':   return json_(saveEvent_(body.event, user));
      case 'delete': return json_(deleteEvent_(body.id, user));
      case 'log':    return json_(recentLog_());
    }
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return json_(errorOut_(err));
  }
}

/* ============ Sign-in ============ */

function login_(b) {
  const cache = CacheService.getScriptCache();
  const deviceKey = 'fail:' + (cleanStr_(b.deviceId, 64) || 'unknown');
  const globalKey = 'fail:all';
  const deviceFails = Number(cache.get(deviceKey) || 0);
  const globalFails = Number(cache.get(globalKey) || 0);
  if (deviceFails >= LOCK_AFTER || globalFails >= GLOBAL_FAIL_LIMIT) {
    fail_('Too many wrong attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  }

  const name = cleanStr_(b.name, 40);
  if (!name) fail_('Add your first name so changes show who made them.');

  if (!safeEqual_(String(b.code || '').trim(), prop_('DIARY_CODE'))) {
    cache.put(deviceKey, String(deviceFails + 1), LOCK_MINUTES * 60);
    cache.put(globalKey, String(globalFails + 1), LOCK_MINUTES * 60);
    fail_("That code isn't right. Check with the club secretary.");
  }
  cache.remove(deviceKey);

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
  const roomDates = {};
  cal_().getEvents(range[0], range[1]).forEach(ev => {
    const x = shape_(ev, false);
    if (x.cat === 'room') {
      roomDates[x.date] = true;
      events.push({ date: x.date, start: x.start, end: x.end, allDay: x.allDay, cat: 'room', title: 'Private party' });
    } else {
      // A committee item ticked "Uses the function room" also blocks that date, whether or not it is public
      if (ev.getTag('room') === '1') roomDates[x.date] = true;
      if (ev.getTag('pub') === '1') events.push({ date: x.date, start: x.start, end: x.end, allDay: x.allDay, cat: x.cat, title: x.title });
    }
  });
  // Stage 3 adds pending booking requests to roomBooked so a requested date shows as taken.
  const out = { ok: true, events: events, roomBooked: Object.keys(roomDates).sort() };
  cache.put(key, JSON.stringify(out), PUBLIC_CACHE_SECONDS);
  return out;
}

function listEvents_(from, to) {
  const range = parseRange_(from, to);
  const events = cal_().getEvents(range[0], range[1]).map(ev => shape_(ev, true));
  return { ok: true, events: events, pending: [] }; // pending booking requests arrive in stage 3
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
  }
  return o;
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

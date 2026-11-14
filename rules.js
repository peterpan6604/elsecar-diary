/* Elsecar Club Diary: room hire rules for the browser (function room and tea room).
   A copy of the rules in apps-script/Code.gs. The server is what really enforces them;
   this copy only gives quick feedback on the form and powers demo mode.
   tests/test-rules.js checks both copies give the same answers. */
(function () {
'use strict';

// max is each room's fire limit (14 Nov 2026). The Settings tab can lower it, never raise it.
const ROOMS = {
  fn:  { label: 'Function room', max: 80 },
  tea: { label: 'Tea room',      max: 50 }
};
const DEFAULT_ROOM = 'fn';
const roomName = k => (ROOMS[k] || ROOMS[DEFAULT_ROOM]).label.toLowerCase();
const SESSIONS = {
  aft: { label: 'Afternoon', time: '12pm to 5pm',      start: '12:00', end: '17:00' },
  eve: { label: 'Evening',   time: '6pm to midnight',  start: '18:00', end: '00:00' },
  day: { label: 'Whole day', time: '12pm to midnight', start: '12:00', end: '00:00' }
};
const TYPES = ['Birthday party', '18th birthday', '21st birthday', 'Wedding or engagement', 'Christening',
  'Funeral wake', 'Anniversary', 'Meeting or class', 'Other'];
const SHORT_NOTICE_TYPE = 'Funeral wake';
const MIN_NOTICE = 7, MAX_MONTHS = 12, MAX_GUESTS = 80; // MAX_GUESTS: the biggest room
/* Payment and refunds (14 Nov 2026). Same as Code.gs, HIRE-TERMS.md and hire-terms.html. */
const PRICE = 50, PAY_WITHIN_DAYS = 7, REFUND_EARLY = 40, REFUND_LATE = 25, REFUND_EARLY_DAYS = 29, REFUND_LATE_DAYS = 14;
const PAYMENT_LINK_RE = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fail(msg) { const e = new Error(msg); e.userFacing = true; throw e; }
function clean(v, max, multiline) {
  let s = String(v == null ? '' : v);
  s = multiline ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return s.trim().slice(0, max);
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function isRealDate(s) {
  if (!isDate(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const utcOf = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoOfUtc = t => { const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
const daysBetween = (a, b) => Math.round((utcOf(b) - utcOf(a)) / 864e5);
const addDays = (s, n) => isoOfUtc(utcOf(s) + n * 864e5);
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return isoOfUtc(Date.UTC(y, m - 1 + n, Math.min(d, lastDay)));
}
function niceDate(s) { const t = new Date(utcOf(s)); return DAYS[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear(); }
const isEmail = s => /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[A-Za-z]{2,}$/.test(String(s || '')) && String(s).length <= 120;

/** Same checks, same order and same messages as validateRequest_ in Code.gs.
    capacity is one number for every room, or { fn: 80, tea: 50 }. Either way it is capped at each room's fire limit. */
function validate(b, today, capacity) {
  const name = clean(b.name, 80);
  if (name.length < 2) fail('Add your name.');
  if (/:\/\/|www\.|[<>@]/i.test(name)) fail('Please type just your name.');
  const phone = clean(b.phone, 25);
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9 +()\-]+$/.test(phone) || digits.length < 10 || digits.length > 15) fail('Add a phone number we can call you on.');
  const email = clean(b.email, 120);
  if (!isEmail(email)) fail('Add an email address so we can reply.');
  const room = b.room == null || b.room === '' ? DEFAULT_ROOM : String(b.room);
  if (!Object.prototype.hasOwnProperty.call(ROOMS, room)) fail('Choose a room: the function room or the tea room.');
  const date = String(b.date || '');
  if (!isRealDate(date)) fail('Choose a date.');
  const sess = String(b.sess || '');
  if (!Object.prototype.hasOwnProperty.call(SESSIONS, sess)) fail('Choose a session: afternoon, evening or the whole day.');
  const type = String(b.type || '');
  if (TYPES.indexOf(type) < 0) fail('Choose the type of event.');
  const g = String(b.guests == null ? '' : b.guests).trim();
  const guests = /^\d{1,4}$/.test(g) ? Number(g) : 0;
  if (guests < 1) fail('Add roughly how many guests.');
  const given = typeof capacity === 'object' ? capacity[room] : capacity;
  const cap = Math.min(Number(given) || ROOMS[room].max, ROOMS[room].max);
  if (guests > cap) fail('The ' + roomName(room) + ' holds up to ' + cap + ' people, including staff and entertainers.');
  const message = clean(b.message, 1000, true);
  const ahead = daysBetween(today, date);
  if (type === SHORT_NOTICE_TYPE) {
    if (ahead < 1) fail('Funeral wakes can be requested from tomorrow onwards. For anything sooner, please ring the club.');
  } else if (ahead < MIN_NOTICE) {
    fail('We need at least ' + MIN_NOTICE + " days' notice. The earliest date you can ask for is " + niceDate(addDays(today, MIN_NOTICE)) + '.');
  }
  if (date > addMonths(today, MAX_MONTHS)) fail('We take requests up to ' + MAX_MONTHS + ' months ahead.');
  return { name, phone, email, room, date, sess, type, guests, message };
}

/** Which bookable session a diary item takes: 'aft', 'eve', 'day', or '' if neither (for example 09:00 to 12:00).
    Same as sessionOfTimes_ in Code.gs. */
function sessionOf(start, end) {
  if (!start) return 'day';
  const mins = t => { const p = String(t || '00:00').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
  const s = mins(start);
  let e = mins(end || '00:00');
  if (e <= s) e += 1440;
  const aft = s < 17 * 60 && e > 12 * 60;
  const eve = s < 24 * 60 && e > 18 * 60;
  return aft && eve ? 'day' : aft ? 'aft' : eve ? 'eve' : '';
}
const clash = (a, b) => !!a && !!b && (a === 'day' || b === 'day' || a === b);
/** The rooms a committee diary item takes ('fn', 'tea' or both). Room hire with no tick is the function room,
    as on the server (roomsOfTags_ in Code.gs). */
function roomsOf(e) {
  const out = [];
  if (e.room || (e.cat === 'room' && !e.tea)) out.push('fn');
  if (e.tea) out.push('tea');
  return out;
}
/** Given the sessions already taken on a date (['aft'], ['aft','eve']...), can this session be asked for? */
const canAsk = (taken, sess) => !(taken || []).some(t => clash(t, sess));

/** Which rooms a saved committee item takes. old is the stored item ({ cat, room, tea } as true/false) when editing,
    or null. Same as roomsForSave_ in Code.gs: with no tea value (a page from before the tea room) the stored rooms are kept. */
function roomsForSave(x, old) {
  let fn = !!x.room, tea = !!x.tea;
  if (old && (x.tea === undefined || x.tea === null)) {
    const had = roomsOf(old);
    tea = had.indexOf('tea') >= 0;
    if (x.cat === 'room') fn = had.indexOf('fn') >= 0;
  }
  if (x.cat === 'room' && !fn && !tea) fn = true;
  return { fn, tea };
}

/* ---- Payment and refunds: same answers and wording as Code.gs (checked by tests/test-rules.js) ---- */
const money = n => '£' + n;
const REQUEST_PRICE_TEXT = 'The hire fee is ' + money(PRICE) + '. You do not pay anything now. If the committee approve your booking, ' +
  'we will email you a link to pay by card. Please pay within ' + PAY_WITHIN_DAYS + ' days of that email.';
const CANCEL_TERMS_TEXT = 'If you need to cancel, reply to this email or contact the club as soon as you can. If you have paid, we refund ' +
  money(REFUND_EARLY) + ' (the fee minus a ' + money(PRICE - REFUND_EARLY) + ' admin fee) if you cancel ' + REFUND_EARLY_DAYS +
  ' days or more before your event, ' + money(REFUND_LATE) + ' if you cancel ' + REFUND_LATE_DAYS + ' to ' + (REFUND_EARLY_DAYS - 1) +
  ' days before, and nothing if you cancel ' + (REFUND_LATE_DAYS - 1) + ' days or fewer before.';
const REFUND_TIME_TEXT = 'Refunds go back to the card you paid with and usually take 5 to 10 working days to arrive.';
const CLUB_REFUND_TEXT = 'If you have paid the ' + money(PRICE) + ' hire fee, we will refund it in full. ' + REFUND_TIME_TEXT;

function payBy(today, eventDate) { const week = addDays(today, PAY_WITHIN_DAYS); return eventDate < week ? eventDate : week; }
function paymentUrl(link, ref, email) {
  if (!PAYMENT_LINK_RE.test(String(link || ''))) return '';
  const id = String(ref || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
  const q = [];
  if (id) q.push('client_reference_id=' + encodeURIComponent(id));
  if (isEmail(email)) q.push('prefilled_email=' + encodeURIComponent(email));
  return link + (q.length ? '?' + q.join('&') : '');
}
function paymentText(link, ref, email, today, eventDate) {
  const url = paymentUrl(link, ref, email);
  if (!url) return 'The hire fee is ' + money(PRICE) + '. The club will be in touch about how to pay it.';
  const by = payBy(today, eventDate);
  return 'The hire fee is ' + money(PRICE) + '. Please pay it by ' + niceDate(by) + (by === eventDate ? ' (the day of your event)' : '') +
    ' using this secure card payment link. The link carries your booking reference, so we can match your payment to your booking.\n' + url +
    '\nIf the fee is not paid by then, the club may cancel the booking.';
}
/** Refund in pounds when the hirer cancels: 29 days or more before the event 40, 14 to 28 days 25, 13 or fewer nothing. */
function refundDue(asked, eventDate) {
  const days = daysBetween(asked, eventDate);
  return days >= REFUND_EARLY_DAYS ? REFUND_EARLY : days >= REFUND_LATE_DAYS ? REFUND_LATE : 0;
}
function hirerRefundText(asked, eventDate) {
  const due = refundDue(asked, eventDate);
  const when = 'You asked us to cancel on ' + niceDate(asked) + ', ' + daysBetween(asked, eventDate) + ' days before your event. ';
  if (due === REFUND_EARLY) return when + 'If you have paid the ' + money(PRICE) + ' hire fee, we will refund ' + money(due) +
    ' (the fee minus a ' + money(PRICE - due) + ' admin fee). ' + REFUND_TIME_TEXT;
  if (due) return when + 'If you have paid the ' + money(PRICE) + ' hire fee, we will refund ' + money(due) + '. ' + REFUND_TIME_TEXT;
  return when + 'As that is less than ' + REFUND_LATE_DAYS + ' days before the event, the hire fee is not refunded.';
}

window.DiaryRules = { ROOMS, DEFAULT_ROOM, roomName, roomsOf, roomsForSave, SESSIONS, TYPES, SHORT_NOTICE_TYPE, MIN_NOTICE, MAX_MONTHS, MAX_GUESTS,
  validate, sessionOf, clash, canAsk, addDays, addMonths, daysBetween, niceDate, isEmail, clean,
  PRICE, PAY_WITHIN_DAYS, REQUEST_PRICE_TEXT, CANCEL_TERMS_TEXT, CLUB_REFUND_TEXT, payBy, paymentUrl, paymentText, refundDue, hirerRefundText };
})();

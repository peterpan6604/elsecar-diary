/* Elsecar Club Diary: function room rules for the browser.
   A copy of the rules in apps-script/Code.gs. The server is what really enforces them;
   this copy only gives quick feedback on the form and powers demo mode.
   tests/test-rules.js checks both copies give the same answers. */
(function () {
'use strict';

const SESSIONS = {
  aft: { label: 'Afternoon', time: '12pm to 5pm',      start: '12:00', end: '17:00' },
  eve: { label: 'Evening',   time: '6pm to midnight',  start: '18:00', end: '00:00' },
  day: { label: 'Whole day', time: '12pm to midnight', start: '12:00', end: '00:00' }
};
const TYPES = ['Birthday party', '18th birthday', '21st birthday', 'Wedding or engagement', 'Christening',
  'Funeral wake', 'Anniversary', 'Meeting or class', 'Other'];
const SHORT_NOTICE_TYPE = 'Funeral wake';
const MIN_NOTICE = 7, MAX_MONTHS = 12, MAX_GUESTS = 75;
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

/** Same checks, same order and same messages as validateRequest_ in Code.gs. */
function validate(b, today, capacity) {
  const name = clean(b.name, 80);
  if (name.length < 2) fail('Add your name.');
  if (/:\/\/|www\.|[<>@]/i.test(name)) fail('Please type just your name.');
  const phone = clean(b.phone, 25);
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9 +()\-]+$/.test(phone) || digits.length < 10 || digits.length > 15) fail('Add a phone number we can call you on.');
  const email = clean(b.email, 120);
  if (!isEmail(email)) fail('Add an email address so we can reply.');
  const date = String(b.date || '');
  if (!isRealDate(date)) fail('Choose a date.');
  const sess = String(b.sess || '');
  if (!Object.prototype.hasOwnProperty.call(SESSIONS, sess)) fail('Choose a session: afternoon, evening or the whole day.');
  const type = String(b.type || '');
  if (TYPES.indexOf(type) < 0) fail('Choose the type of event.');
  const g = String(b.guests == null ? '' : b.guests).trim();
  const guests = /^\d{1,4}$/.test(g) ? Number(g) : 0;
  if (guests < 1) fail('Add roughly how many guests.');
  if (guests > capacity) fail('The room holds up to ' + capacity + ' people, including staff and entertainers.');
  const message = clean(b.message, 1000, true);
  const ahead = daysBetween(today, date);
  if (type === SHORT_NOTICE_TYPE) {
    if (ahead < 1) fail('Funeral wakes can be requested from tomorrow onwards. For anything sooner, please ring the club.');
  } else if (ahead < MIN_NOTICE) {
    fail('We need at least ' + MIN_NOTICE + " days' notice. The earliest date you can ask for is " + niceDate(addDays(today, MIN_NOTICE)) + '.');
  }
  if (date > addMonths(today, MAX_MONTHS)) fail('We take requests up to ' + MAX_MONTHS + ' months ahead.');
  return { name, phone, email, date, sess, type, guests, message };
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
/** Given the sessions already taken on a date (['aft'], ['aft','eve']...), can this session be asked for? */
const canAsk = (taken, sess) => !(taken || []).some(t => clash(t, sess));

window.DiaryRules = { SESSIONS, TYPES, SHORT_NOTICE_TYPE, MIN_NOTICE, MAX_MONTHS, MAX_GUESTS,
  validate, sessionOf, clash, canAsk, addDays, addMonths, daysBetween, niceDate, isEmail, clean };
})();

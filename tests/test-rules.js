// Checks the pure booking rules in apps-script/Code.gs without Google.
// Run from the repo folder:  node tests/test-rules.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
const G = ctx;

let pass = 0, failed = 0;
function ok(cond, label) { if (cond) pass++; else { failed++; console.log('FAIL: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')'); }
function throws(fn, re, label) {
  try { fn(); ok(false, label + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message) && e.userFacing === true, label + ' (message: ' + e.message + ')'); }
}

const TODAY = '2026-11-07';
const good = { name: 'Sarah Kay', phone: '07700 900123', email: 'sarah@example.com', date: '2026-11-21',
  sess: 'eve', type: 'Birthday party', guests: '60', message: 'Own DJ.' };
const v = o => G.validateRequest_(Object.assign({}, good, o), TODAY, 75);

/* valid request */
const r = v({});
eq([r.name, r.date, r.sess, r.guests], ['Sarah Kay', '2026-11-21', 'eve', 60], 'valid request comes back clean');

/* notice */
eq(v({ date: '2026-11-14' }).date, '2026-11-14', 'exactly 7 days notice is allowed');
throws(() => v({ date: '2026-11-13' }), /7 days' notice.*Saturday 14 November 2026/, '6 days notice is refused and names the earliest date');
throws(() => v({ date: '2026-11-01' }), /notice/, 'a past date is refused');
eq(v({ date: '2026-11-08', type: 'Funeral wake' }).date, '2026-11-08', 'a funeral wake can be tomorrow');
throws(() => v({ date: '2026-11-07', type: 'Funeral wake' }), /Funeral wakes/, 'a funeral wake today is refused');
throws(() => v({ date: '2026-11-08', type: '18th birthday' }), /notice/, 'short notice is refused for other types');

/* 12 months ahead */
eq(v({ date: '2027-11-07' }).date, '2027-11-07', 'exactly 12 months ahead is allowed');
throws(() => v({ date: '2027-11-08' }), /12 months/, '12 months and a day is refused');

/* guests */
eq(v({ guests: 75 }).guests, 75, '75 guests is allowed');
throws(() => v({ guests: 76 }), /up to 75/, '76 guests is refused');
throws(() => v({ guests: 0 }), /guests/, '0 guests is refused');
throws(() => v({ guests: '12.5' }), /guests/, 'a fraction of a guest is refused');
throws(() => v({ guests: '-3' }), /guests/, 'negative guests refused');
throws(() => G.validateRequest_(Object.assign({}, good, { guests: 61 }), TODAY, 60), /up to 60/, 'a lower Settings capacity is used');

/* fields */
throws(() => v({ name: '' }), /name/, 'missing name');
throws(() => v({ name: 'Visit https://spam.example' }), /just your name/, 'a link in the name is refused');
throws(() => v({ name: '<script>' }), /just your name/, 'markup in the name is refused');
throws(() => v({ phone: '123' }), /phone/, 'short phone');
throws(() => v({ phone: '=HYPERLINK("x")' }), /phone/, 'formula in phone');
eq(v({ phone: '+44 7700 900123' }).phone, '+44 7700 900123', 'international phone kept as typed');
throws(() => v({ email: 'not-an-email' }), /email/, 'bad email');
throws(() => v({ email: 'a@b.com, victim@c.com' }), /email/, 'two emails in one field refused');
throws(() => v({ date: '2026-02-30' }), /date/, 'impossible date');
throws(() => v({ date: '21/11/2026' }), /date/, 'wrong date format');
throws(() => v({ sess: 'night' }), /session/, 'unknown session');
throws(() => v({ sess: 'constructor' }), /session/, 'prototype key as session');
throws(() => v({ type: 'Rave' }), /type of event/, 'type not on the list');
eq(v({ message: 'x'.repeat(5000) }).message.length, 1000, 'long message is cut to 1000');
eq(v({ name: '  Sarah\u0000 Kay  ' }).name, 'Sarah  Kay', 'control characters removed');

/* formula guard */
eq(G.safeCell_('=SUM(A1)'), "'=SUM(A1)", 'formula = neutralised');
eq(G.safeCell_('+44 7700'), "'+44 7700", 'leading + neutralised');
eq(G.safeCell_('-1'), "'-1", 'leading - neutralised');
eq(G.safeCell_('@here'), "'@here", 'leading @ neutralised');
eq(G.safeCell_('Sarah'), 'Sarah', 'normal text untouched');

/* sessions */
eq(G.sessionOfTimes_('12:00', '17:00'), 'aft', 'afternoon session');
eq(G.sessionOfTimes_('18:00', '00:00'), 'eve', 'evening session to midnight');
eq(G.sessionOfTimes_('12:00', '00:00'), 'day', 'whole day');
eq(G.sessionOfTimes_('20:00', '01:00'), 'eve', 'past midnight is evening');
eq(G.sessionOfTimes_('11:00', '15:00'), 'aft', 'craft fair 11 to 3 is afternoon');
eq(G.sessionOfTimes_('', ''), 'day', 'all day item takes the whole day');
eq(G.sessionOfTimes_('15:00', '20:00'), 'day', '3pm to 8pm crosses both sessions');
eq(G.takenSessions_([{ date: 'A', sess: 'day' }, { date: 'B', sess: 'eve' }]), { A: ['aft', 'eve'], B: ['eve'] }, 'taken sessions map');
ok(!G.isFreeIn_([{ date: 'A', sess: 'eve' }], 'A', 'day'), 'whole day blocked by an evening');
ok(G.isFreeIn_([{ date: 'A', sess: 'eve' }], 'A', 'aft'), 'afternoon free beside an evening');
ok(G.isFreeIn_([{ date: 'B', sess: 'day' }], 'A', 'aft'), 'other dates do not block');

/* clash notes */
const p1 = { id: 'ECC-AAAAAA', date: 'A', sess: 'eve' }, p2 = { id: 'ECC-BBBBBB', date: 'A', sess: 'day' }, p3 = { id: 'ECC-CCCCCC', date: 'A', sess: 'aft' };
ok(/ECC-BBBBBB/.test(G.clashNote_(p1, [p1, p2, p3], [])), 'evening clashes with a whole day request');
ok(/2 other requests/.test(G.clashNote_(p2, [p1, p2, p3], [])), 'whole day clashes with both');
eq(G.clashNote_(p3, [p1, p3], []), '', 'afternoon and evening requests do not clash');
ok(/in use that day: Quiz/.test(G.clashNote_(p1, [p1], [{ date: 'A', sess: 'eve', title: 'Quiz' }])), 'clash with a committee room item');

/* dates */
eq(G.addMonthsIso_('2026-08-31', -6), '2026-02-28', '31 Aug minus 6 months');
eq(G.addMonthsIso_('2028-02-29', 12), '2029-02-28', 'leap day plus a year');
eq(G.addMonthsIso_('2026-11-07', -6), '2026-05-07', 'clean-up cut off');
eq(G.daysBetween_('2026-03-28', '2026-03-30'), 2, 'days across the clock change');
eq(G.niceDate_('2026-11-14'), 'Saturday 14 November 2026', 'nice date');

/* settings */
eq(G.committeeEmails_({ 'Notification emails': 'a@x.com, b@y.org;bad, c@z.co.uk' }), ['a@x.com', 'b@y.org', 'c@z.co.uk'], 'committee emails parsed, bad one dropped');
eq(G.termsUrl_({ 'Hire terms link': 'javascript:alert(1)' }), '', 'unsafe terms link dropped');
eq(G.termsUrl_({ 'Hire terms link': 'https://elsecarcc.co.uk/hire' }), 'https://elsecarcc.co.uk/hire', 'https terms link kept');
eq(G.capacity_({ 'Room capacity': '200' }), 75, 'capacity cannot be raised above 75');
eq(G.capacity_({ 'Room capacity': '' }), 75, 'blank capacity means 75');
eq(G.sessKey_('Evening', '18:00', '00:00'), 'eve', 'session read back from the sheet');

/* the browser copy (rules.js) must give the same answers as the server */
const bctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'rules.js'), 'utf8'), bctx);
const B = bctx.window.DiaryRules;
const answer = (fn) => { try { return JSON.stringify(fn()); } catch (e) { return 'ERR ' + e.message; } };
[
  {}, { date: '2026-11-14' }, { date: '2026-11-13' }, { date: '2026-11-08', type: 'Funeral wake' }, { date: '2026-11-07', type: 'Funeral wake' },
  { date: '2027-11-07' }, { date: '2027-11-08' }, { guests: 75 }, { guests: 76 }, { guests: '' }, { name: 'a' }, { name: 'x www.y' },
  { phone: '0770' }, { email: 'x@y' }, { date: '2026-13-01' }, { sess: 'aft' }, { sess: 'toString' }, { type: 'Other' }, { type: 'x' },
  { message: '<img src=x onerror=alert(1)>' }, { name: '=cmd|calc' }
].forEach((o, i) => {
  const input = Object.assign({}, good, o);
  eq(answer(() => B.validate(input, TODAY, 75)), answer(() => G.validateRequest_(input, TODAY, 75)), 'browser and server agree on case ' + i);
});
['12:00|17:00', '18:00|00:00', '12:00|00:00', '20:00|01:00', '|', '15:00|20:00', '17:00|18:00', '09:00|12:00'].forEach(t => {
  const [a, b] = t.split('|');
  eq(B.sessionOf(a, b), G.sessionOfTimes_(a, b), 'browser and server agree on session ' + t);
});

console.log(pass + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

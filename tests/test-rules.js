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
eq(G.sessionOfTimes_('09:00', '12:00'), '', 'a morning only item 9 to 12 takes no bookable session');
eq(G.sessionOfTimes_('10:00', '14:00'), 'aft', '10 to 2 takes the afternoon');
eq(G.sessionOfTimes_('18:00', '23:00'), 'eve', '6pm to 11pm is the evening');
eq(G.sessionOfTimes_('17:00', '18:00'), '', 'the gap between sessions takes neither');
eq(G.sessionOfTimes_('16:30', '17:30'), 'aft', 'overlapping the end of the afternoon takes it');
eq(G.sessionOfTimes_('12:00', '00:00'), 'day', 'noon to midnight is the whole day');
ok(G.isFreeIn_([{ date: 'A', sess: G.sessionOfTimes_('09:00', '12:00') }], 'A', 'day'), 'a morning item does not block even the whole day');
ok(!G.sessionsClash_('', 'day') && !G.sessionsClash_('aft', ''), 'no session never clashes');
eq(G.takenSessions_([{ date: 'A', sess: '' }]), { A: [] }, 'a morning item marks nothing taken');
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

/* tea room: a second room with its own availability */
eq(v({ room: 'tea' }).room, 'tea', 'a tea room request is accepted');
eq(v({}).room, 'fn', 'a request with no room (an older page) is for the function room');
eq(v({ room: '' }).room, 'fn', 'a blank room is the function room');
throws(() => v({ room: 'bar' }), /Choose a room/, 'an unknown room is refused');
throws(() => v({ room: 'constructor' }), /Choose a room/, 'prototype key as room is refused');
throws(() => G.validateRequest_(Object.assign({}, good, { room: 'tea', guests: 51 }), TODAY, { fn: 75, tea: 50 }), /tea room holds up to 50/, 'the tea room capacity is used for a tea room request');
eq(G.validateRequest_(Object.assign({}, good, { guests: 70 }), TODAY, { fn: 75, tea: 50 }).guests, 70, 'the function room keeps its own capacity');
eq(G.capacity_({ 'Tea room capacity': '60' }, 'tea'), 60, 'tea room capacity read from Settings');
eq(G.capacity_({}, 'tea'), 75, 'no tea room capacity row means 75');
eq(G.capacity_({ 'Tea room capacity': '90' }, 'tea'), 75, 'tea room capacity cannot be raised above 75');
eq(G.capacity_({ 'Room capacity': '40', 'Tea room capacity': '60' }), 40, 'Room capacity is still the function room');
eq(G.capacities_({ 'Tea room capacity': '50' }), { fn: 75, tea: 50 }, 'both capacities together');

const fnEve = { date: 'A', sess: 'eve', room: 'fn' }, teaEve = { date: 'A', sess: 'eve', room: 'tea' };
ok(G.isFreeIn_([fnEve], 'A', 'eve', 'tea'), 'tea room evening free while the function room is booked that evening');
ok(G.isFreeIn_([teaEve], 'A', 'eve', 'fn'), 'function room evening free while the tea room is booked that evening');
ok(!G.isFreeIn_([teaEve], 'A', 'eve', 'tea'), 'same room same session is refused');
ok(!G.isFreeIn_([teaEve], 'A', 'day', 'tea'), 'tea room whole day blocked by a tea room evening');
ok(!G.isFreeIn_([{ date: 'A', sess: 'eve' }], 'A', 'eve', 'fn'), 'a use with no room counts as the function room');
ok(G.isFreeIn_([{ date: 'A', sess: 'eve' }], 'A', 'eve', 'tea'), 'a use with no room does not block the tea room');
eq(G.takenByRoom_([fnEve, { date: 'A', sess: 'aft', room: 'tea' }, { date: 'B', sess: 'day' }]),
  { fn: { A: ['eve'], B: ['aft', 'eve'] }, tea: { A: ['aft'] } }, 'taken sessions kept apart per room, no room means function room');

/* which rooms a calendar event takes, from its tags */
eq(G.roomsOfTags_('room', '1', ''), ['fn'], 'an old room hire event (no tea tag) is the function room');
eq(G.roomsOfTags_('room', null, null), ['fn'], 'room hire with no tags at all is the function room');
eq(G.roomsOfTags_('room', '0', '1'), ['tea'], 'a tea room booking takes only the tea room');
eq(G.roomsOfTags_('room', '1', '1'), ['fn', 'tea'], 'room hire can take both rooms');
eq(G.roomsOfTags_('club', '', '1'), ['tea'], 'the tea room tick blocks the tea room only');
eq(G.roomsOfTags_('club', '1', ''), ['fn'], 'the function room tick blocks the function room only');
eq(G.roomsOfTags_('club', '1', '1'), ['fn', 'tea'], 'both ticks block both rooms');
eq(G.roomsOfTags_('club', null, null), [], 'an untagged event takes no room');
eq(G.roomsOfTags_('staff', '0', '0'), [], 'a bar cover reminder takes no room');

/* older Bookings rows have no Room */
eq(G.roomKey_(''), 'fn', 'a blank Room cell is the function room');
eq(G.roomKey_(undefined), 'fn', 'a missing Room cell is the function room');
eq(G.roomKey_('Tea room'), 'tea', 'Tea room read back from the sheet');
eq(G.roomKey_(' tea ROOM '), 'tea', 'Tea room typed by hand is still understood');
eq(G.roomKey_('Function room'), 'fn', 'Function room read back from the sheet');
eq(G.bookingRowValues_({ id: 'ECC-AAAAAA', sess: 'eve', room: 'tea' })[18], 'Tea room', 'room saved to the sheet as its label');
eq(G.bookingRowValues_({ id: 'ECC-AAAAAA' }).length, 19, 'a booking row has 19 columns');

/* a Room cell that matches neither room */
eq(G.roomKey_('Bar'), 'unknown', 'an unrecognised Room cell is not quietly the function room');
eq(G.roomKey_('Function'), 'unknown', 'a part name is not recognised either');
ok(G.sameRoom_('unknown', 'tea') && G.sameRoom_('fn', 'unknown'), 'an unrecognised room is treated as taking both rooms in clash checks');
ok(G.sameRoom_('', 'fn') && !G.sameRoom_('fn', 'tea'), 'blank is the function room, and the two rooms are different');
const u1 = { id: 'ECC-UUUUU1', date: 'A', sess: 'eve', room: 'unknown' };
ok(/Room not recognised/.test(G.clashNote_(u1, [u1], [])), 'committee is told the room is not recognised');
ok(/ECC-TTTTT9/.test(G.clashNote_(u1, [u1, { id: 'ECC-TTTTT9', date: 'A', sess: 'eve', room: 'tea' }], [])), 'an unrecognised room clashes with a tea room request');
ok(/ECC-UUUUU1/.test(G.clashNote_({ id: 'ECC-FFFFF9', date: 'A', sess: 'day', room: 'fn' }, [u1], [])), 'and with a function room request');
eq(G.bookingRowValues_({ id: 'ECC-AAAAAA', room: 'unknown', roomText: 'Bar' })[18], 'Bar', 'an unrecognised room is written back exactly as typed');
eq(G.roomName_('unknown'), 'room', 'emails say just "room" for an unrecognised room');

/* saving a committee item: which rooms it takes */
const sv = (x, old) => G.roomsForSave_(x, old);
const teaOnly = { cat: 'club', room: '0', tea: '1' }, teaHire = { cat: 'room', room: '0', tea: '1' };
eq(sv({ cat: 'club', room: false }, teaOnly), { fn: false, tea: true }, 'an old page editing an item keeps its tea room tick');
eq(sv({ cat: 'room', room: true }, teaHire), { fn: false, tea: true }, 'an old page editing tea room hire does not flip it to the function room');
eq(sv({ cat: 'club', room: true }, { cat: 'club', room: '1', tea: '1' }), { fn: true, tea: true }, 'an old page keeps both ticks');
eq(sv({ cat: 'club', room: false }, { cat: 'club', room: '1', tea: '0' }), { fn: false, tea: false }, 'an old page can still untick the function room on an ordinary item');
eq(sv({ cat: 'room', room: true }, { cat: 'room', room: '1', tea: '' }), { fn: true, tea: false }, 'an old page editing an older function room hire keeps the function room');
eq(sv({ cat: 'room', room: true }, null), { fn: true, tea: false }, 'a new room hire item from an old page is the function room');
eq(sv({ cat: 'room' }, null), { fn: true, tea: false }, 'room hire with nothing ticked is the function room');
eq(sv({ cat: 'club', room: false, tea: false }, teaOnly), { fn: false, tea: false }, 'the new page can untick the tea room');
eq(sv({ cat: 'room', room: false, tea: true }, { cat: 'room', room: '1', tea: '0' }), { fn: false, tea: true }, 'the new page can move room hire to the tea room');
eq(sv({ cat: 'club', room: false, tea: true }, null), { fn: false, tea: true }, 'a new item ticked for the tea room only');

/* clash notes per room */
const t1 = { id: 'ECC-TTTTT1', date: 'A', sess: 'eve', room: 'tea' }, f1 = { id: 'ECC-FFFFF1', date: 'A', sess: 'eve', room: 'fn' };
eq(G.clashNote_(t1, [t1, f1], []), '', 'tea room and function room requests the same evening do not clash');
ok(/ECC-TTTTT2/.test(G.clashNote_(t1, [t1, { id: 'ECC-TTTTT2', date: 'A', sess: 'day', room: 'tea' }], [])), 'two tea room requests the same session clash');
ok(/ECC-FFFFF1/.test(G.clashNote_({ id: 'ECC-OLD001', date: 'A', sess: 'eve' }, [f1], [])), 'an old request with no room clashes with a function room request');
ok(/tea room is already in use that day: Quiz/.test(G.clashNote_(t1, [t1], [{ date: 'A', sess: 'eve', room: 'tea', title: 'Quiz' }])), 'clash with a committee tea room item names the tea room');
eq(G.clashNote_(t1, [t1], [{ date: 'A', sess: 'eve', room: 'fn', title: 'Quiz' }]), '', 'a function room item does not clash with a tea room request');
eq(G.detailLines_('tea', '2026-11-21', 'eve', 'Birthday party', 40, 'ECC-AAAAAA').split('\n')[0], 'Room: Tea room', 'emails name the room');

/* contact clean-up */
const T2 = '2026-11-07';
ok(G.purgeDue_({ status: 'Approved', date: '2026-05-06', received: '2026-01-01 10:00' }, T2), 'event over 6 months ago is cleared');
ok(!G.purgeDue_({ status: 'Approved', date: '2026-05-07', received: '2026-01-01 10:00' }, T2), 'event exactly 6 months ago is kept until next month');
ok(G.purgeDue_({ status: 'Pending', date: '', received: '2026-04-01 10:00' }, T2), 'blank event date uses the received date');
ok(!G.purgeDue_({ status: 'Pending', date: 'rubbish', received: '2026-10-01 10:00' }, T2), 'unreadable date with a recent received date is kept');
ok(G.purgeDue_({ status: 'Pending', date: '', received: '' }, T2), 'no readable date at all is treated as old');
ok(G.purgeDue_({ status: 'Declined', date: '2027-06-01', at: '2026-10-08 09:00', received: '2026-10-01 10:00' }, T2), 'declined 30 days ago is cleared even for a future date');
ok(!G.purgeDue_({ status: 'Declined', date: '2027-06-01', at: '2026-10-09 09:00', received: '2026-10-01 10:00' }, T2), 'declined 29 days ago is kept');
ok(G.purgeDue_({ status: 'Declined', date: '2027-06-01', at: '', received: '2026-09-01 10:00' }, T2), 'declined with no decision date uses received');

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
  { message: '<img src=x onerror=alert(1)>' }, { name: '=cmd|calc' },
  { room: 'tea' }, { room: 'fn' }, { room: '' }, { room: 'Tea room' }, { room: 'toString' }, { room: 'tea', guests: 51 }, { room: 'tea', sess: 'x' }
].forEach((o, i) => {
  const input = Object.assign({}, good, o);
  eq(answer(() => B.validate(input, TODAY, 75)), answer(() => G.validateRequest_(input, TODAY, 75)), 'browser and server agree on case ' + i);
  const caps = { fn: 75, tea: 50 };
  eq(answer(() => B.validate(input, TODAY, caps)), answer(() => G.validateRequest_(input, TODAY, caps)), 'browser and server agree on case ' + i + ' with two capacities');
});
[{ cat: 'room' }, { cat: 'room', room: true }, { cat: 'room', tea: true }, { cat: 'room', room: true, tea: true }, { cat: 'club' },
  { cat: 'club', tea: true }, { cat: 'club', room: true }, { cat: 'club', room: true, tea: true }].forEach(e => {
  eq(B.roomsOf(e), G.roomsOfTags_(e.cat, e.room ? '1' : '0', e.tea ? '1' : '0'), 'browser and server agree on rooms for ' + JSON.stringify(e));
});
['12:00|17:00', '18:00|00:00', '12:00|00:00', '20:00|01:00', '|', '15:00|20:00', '17:00|18:00', '09:00|12:00', '10:00|14:00', '18:00|23:00', '16:30|17:30', '00:00|03:00', '11:00|12:30'].forEach(t => {
  const [a, b] = t.split('|');
  eq(B.sessionOf(a, b), G.sessionOfTimes_(a, b), 'browser and server agree on session ' + t);
});

['', 'aft', 'eve', 'day'].forEach(a => ['', 'aft', 'eve', 'day'].forEach(b => eq(B.clash(a, b), G.sessionsClash_(a, b), 'browser and server agree on clash ' + a + '/' + b)));

const olds = [null, { cat: 'club', room: false, tea: true }, { cat: 'room', room: false, tea: true }, { cat: 'room', room: true, tea: false },
  { cat: 'club', room: true, tea: true }, { cat: 'club', room: false, tea: false }];
const sends = [{ cat: 'club', room: false }, { cat: 'club', room: true }, { cat: 'room', room: true }, { cat: 'room' },
  { cat: 'club', room: false, tea: false }, { cat: 'room', room: false, tea: true }, { cat: 'club', room: true, tea: true }];
olds.forEach(o => sends.forEach(x => {
  const tags = o && { cat: o.cat, room: o.room ? '1' : '0', tea: o.tea ? '1' : '0' };
  eq(B.roomsForSave(x, o), G.roomsForSave_(x, tags), 'browser and server agree on saving ' + JSON.stringify(x) + ' over ' + JSON.stringify(o));
}));

console.log(pass + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

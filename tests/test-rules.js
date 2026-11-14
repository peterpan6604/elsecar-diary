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
eq(v({ room: 'tea', guests: 40 }).room, 'tea', 'a tea room request is accepted');
eq(v({}).room, 'fn', 'a request with no room (an older page) is for the function room');
eq(v({ room: '' }).room, 'fn', 'a blank room is the function room');
throws(() => v({ room: 'bar' }), /Choose a room/, 'an unknown room is refused');
throws(() => v({ room: 'constructor' }), /Choose a room/, 'prototype key as room is refused');
throws(() => G.validateRequest_(Object.assign({}, good, { room: 'tea', guests: 51 }), TODAY, { fn: 75, tea: 50 }), /tea room holds up to 50/, 'the tea room capacity is used for a tea room request');
eq(G.validateRequest_(Object.assign({}, good, { guests: 70 }), TODAY, { fn: 75, tea: 50 }).guests, 70, 'the function room keeps its own capacity');
eq(G.capacity_({ 'Tea room capacity': '40' }, 'tea'), 40, 'tea room capacity read from Settings');
eq(G.capacity_({}, 'tea'), 50, 'no tea room capacity row means 50');
eq(G.capacity_({ 'Tea room capacity': '90' }, 'tea'), 50, 'tea room capacity cannot be raised above 50');
eq(G.capacity_({ 'Room capacity': '40', 'Tea room capacity': '30' }), 40, 'Room capacity is still the function room');
eq(G.capacities_({ 'Tea room capacity': '50' }), { fn: 80, tea: 50 }, 'both capacities together');

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

/* capacities from 14 Nov 2026: function room 80, tea room 50. Settings can lower, never raise */
const caps = G.capacities_({});
eq(caps, { fn: 80, tea: 50 }, 'no Settings rows: 80 and 50');
eq(G.capacities_({ 'Room capacity': '75', 'Tea room capacity': '75' }), { fn: 75, tea: 50 }, 'the old 75 rows: 75 is still allowed for the function room, the tea room is capped at 50');
eq(G.capacities_({ 'Room capacity': '81', 'Tea room capacity': '51' }), { fn: 80, tea: 50 }, 'one over the limit is capped');
eq(G.capacities_({ 'Room capacity': '60', 'Tea room capacity': '20' }), { fn: 60, tea: 20 }, 'Settings can lower both');
eq(G.capacities_({ 'Room capacity': '0', 'Tea room capacity': 'lots' }), { fn: 80, tea: 50 }, 'nonsense in Settings means the fire limit');
const vc = (o, c) => G.validateRequest_(Object.assign({}, good, o), TODAY, c);
eq(vc({ guests: 80 }, caps).guests, 80, '80 guests in the function room');
throws(() => vc({ guests: 81 }, caps), /function room holds up to 80/, '81 guests in the function room is refused');
eq(vc({ room: 'tea', guests: 50 }, caps).guests, 50, '50 guests in the tea room');
throws(() => vc({ room: 'tea', guests: 51 }, caps), /tea room holds up to 50/, '51 guests in the tea room is refused');
throws(() => vc({ room: 'tea', guests: 60 }, { fn: 80, tea: 75 }), /tea room holds up to 50/, 'a caller passing 75 for the tea room still cannot go above 50');
throws(() => vc({ guests: 85 }, 100), /up to 80/, 'one big number for every room is still capped at 80');
throws(() => vc({ room: 'tea', guests: 31 }, { fn: 80, tea: 30 }), /up to 30/, 'a lowered tea room capacity is used');

/* payment link (Settings "Payment link") */
const LINK = 'https://buy.stripe.com/aEU5kD8Cs0Kn9Hy4gg';
eq(G.paymentLink_({ 'Payment link': LINK }), LINK, 'a live Stripe Payment Link is accepted');
eq(G.paymentLink_({ 'Payment link': '  ' + LINK + ' ' }), LINK, 'spaces around the link are ignored');
eq(G.paymentLink_({}), '', 'no Payment link row (setupPayments not run) means no link');
eq(G.paymentLink_({ 'Payment link': '' }), '', 'a blank row means no link');
['http://buy.stripe.com/aEU5kD8Cs0Kn', 'https://buy.stripe.com.evil.example/aEU5', 'https://evil.example/buy.stripe.com/aEU5',
  'https://buy.stripe.com/test_aEU5kD8Cs0Kn', 'https://buy.stripe.com/aEU5?client_reference_id=x', 'https://buy.stripe.com/',
  'https://checkout.stripe.com/c/pay/cs_live_x', 'javascript:alert(1)', 'https://buy.stripe.com/aEU5 https://evil.example',
  'https://BUY.stripe.com/aEU5', 'https://buy.stripe.com/aEU5#x', 'https://buy.stripe.com/aEU5/'].forEach(bad => {
  eq(G.paymentLink_({ 'Payment link': bad }), '', 'refused payment link ' + bad);
});
eq(G.paymentUrl_(LINK, 'ECC-AB12CD', 'sarah@example.com'), LINK + '?client_reference_id=ECC-AB12CD&prefilled_email=sarah%40example.com', 'reference and email appended, URL encoded');
eq(G.paymentUrl_(LINK, 'ECC-AB12CD', 'not an email'), LINK + '?client_reference_id=ECC-AB12CD', 'a bad email is left off');
eq(G.paymentUrl_(LINK, 'ECC-AB 12&x=1', ''), LINK + '?client_reference_id=ECC-AB12x1', 'characters Stripe would drop are removed from the reference');
eq(G.paymentUrl_(LINK, '', 'a+b@x.com'), LINK + '?prefilled_email=a%2Bb%40x.com', 'a + in an email is encoded');
eq(G.paymentUrl_('https://evil.example/pay', 'ECC-AB12CD', ''), '', 'paymentUrl refuses a link that is not Stripe');

/* pay by date: 7 days after confirming, or the day of the event if sooner */
eq(G.payBy_('2026-11-14', '2026-12-19'), '2026-11-21', 'pay within 7 days');
eq(G.payBy_('2026-11-14', '2026-11-21'), '2026-11-21', 'event exactly 7 days away: pay by then');
eq(G.payBy_('2026-11-14', '2026-11-15'), '2026-11-15', 'a wake tomorrow: pay by the day of the event');

/* confirmation email */
const bk = { name: 'Sarah Kay', room: 'fn', date: '2026-12-19', sess: 'eve', type: 'Birthday party', guests: '60', id: 'ECC-AB12CD', email: 'sarah@example.com' };
const conf = G.confirmationLines_(bk, LINK, 'https://peterpan6604.github.io/elsecar-diary/hire-terms.html', '2026-11-14').join('\n\n');
ok(conf.indexOf(LINK + '?client_reference_id=ECC-AB12CD') >= 0, 'confirmation email has the payment link with the reference');
ok(/£50/.test(conf) && /by Saturday 21 November 2026/.test(conf), 'confirmation email gives the fee and the pay by date');
ok(/may cancel the booking/.test(conf), 'confirmation email says the club may cancel if unpaid');
ok(conf.indexOf('https://peterpan6604.github.io/elsecar-diary/hire-terms.html') >= 0, 'confirmation email has the hire terms link');
ok(/£40/.test(conf) && /£25/.test(conf) && /29 days or more/.test(conf) && /14 to 28 days/.test(conf) && /13 days or fewer/.test(conf), 'confirmation email sums up the refund rules');
ok(!/[\u2013\u2014]/.test(conf), 'no dashes in the confirmation email');
const blank = G.confirmationLines_(bk, '', '', '2026-11-14').join('\n\n');
ok(/The hire fee is £50\. The club will be in touch about how to pay it\./.test(blank), 'no payment link: the club will be in touch about payment');
ok(!/stripe/i.test(blank), 'no payment link: nothing about Stripe');
ok(/The club will send you the hire terms/.test(blank), 'no terms link: the club will send the terms');
const bad = G.confirmationLines_(bk, 'https://evil.example/pay', '', '2026-11-14').join('\n\n');
ok(/will be in touch about how to pay/.test(bad) && bad.indexOf('evil') < 0, 'a bad payment link is never sent to a customer');
ok(/pay it by Tuesday 15 December 2026 \(the day of your event\)/.test(G.paymentText_(LINK, 'ECC-AB12CD', '', '2026-12-14', '2026-12-15')), 'short notice: pay by the day of the event');

/* refunds when the hirer cancels. Event Saturday 19 December 2026 */
const EV = '2026-12-19';
eq(G.refundDue_('2026-11-14', EV), 40, '35 days before: £40');
eq(G.refundDue_('2026-11-20', EV), 40, '29 days before ("more than 28 days"): £40');
eq(G.refundDue_('2026-11-21', EV), 25, 'exactly 28 days before: £25');
eq(G.refundDue_('2026-12-05', EV), 25, 'exactly 14 days before: £25');
eq(G.refundDue_('2026-12-06', EV), 0, '13 days before ("less than 14 days"): nothing');
eq(G.refundDue_(EV, EV), 0, 'on the day: nothing');
eq(G.refundDue_('2026-03-01', '2026-03-29'), 25, '28 days across the clock change is still 28');
ok(/refund £40 \(the fee minus a £10 admin fee\)/.test(G.hirerRefundText_('2026-11-20', EV)), 'early refund wording names the £10 admin fee');
ok(/29 days before your event/.test(G.hirerRefundText_('2026-11-20', EV)), 'the refund wording says how many days');
ok(/refund £25\./.test(G.hirerRefundText_('2026-11-21', EV)), '28 days wording: £25');
ok(/not refunded/.test(G.hirerRefundText_('2026-12-06', EV)) && !/refund £/.test(G.hirerRefundText_('2026-12-06', EV)), '13 days wording: no refund');
const club = G.clubCancelLines_(bk, 'Essential repairs').join('\n\n');
ok(/refund it in full/.test(club) && /If you have paid/.test(club), 'club cancellation: full refund if paid');
ok(/Reason: Essential repairs/.test(club), 'club cancellation gives the reason');
const hirer = G.hirerCancelLines_(bk, '', '2026-11-21').join('\n\n');
ok(/As you asked/.test(hirer) && /£25/.test(hirer) && !/The committee said/.test(hirer), 'hirer cancellation email, no note');

/* cancelling: who must be stated, so an old cached committee page cannot promise a full refund by mistake */
const U = { name: 'Tester' };
throws(() => G.cancelBooking_('ECC-AAAAAA', 'Essential repairs', U), /refresh the committee page/, 'no who (an old committee page) is refused');
throws(() => G.cancelBooking_('ECC-AAAAAA', 'Essential repairs', U, 'Club'), /refresh the committee page/, 'who must be exactly club');
throws(() => G.cancelBooking_('ECC-AAAAAA', 'Essential repairs', U, 'customer'), /refresh the committee page/, 'an unknown who is refused');
throws(() => G.cancelBooking_('ECC-AAAAAA', '', U, 'club'), /Add a reason/, 'the club must give a reason');
throws(() => G.cancelBooking_('ECC-AAAAAA', '', U, 'hirer', 'yesterday'), /Add the date/, 'the customer route needs a real date');

/* the date the customer asked to cancel */
const ad = (asked, received) => G.askedDateError_(asked, EV, received, '2026-11-14');
eq(ad('2026-11-14', '2026-10-01 10:00'), '', 'asked today is fine');
eq(ad('2026-10-01', '2026-10-01 10:00'), '', 'asked the same day they sent the request is fine');
ok(/before they sent their request \(Wednesday 30 September 2026\)/.test(ad('2026-09-29', '2026-09-30 10:00')), 'asked before the request was sent is refused');
ok(/in the future/.test(ad('2026-11-15', '2026-10-01 10:00')), 'a future date is refused');
ok(/after the event/.test(G.askedDateError_('2026-11-14', '2026-11-10', '2026-10-01 10:00', '2026-11-20')), 'a date after the event is refused');
eq(ad('2025-10-14', ''), '', 'no Received date: 13 months ago is still allowed');
ok(/too long ago/.test(ad('2025-10-13', '')), 'no Received date: more than 13 months ago is refused');
ok(/too long ago/.test(ad('2025-01-01', 'rubbish')), 'unreadable Received date: falls back to 13 months');
ok(/Add the date/.test(ad('', '2026-10-01 10:00')), 'a blank date is refused');

/* "1 day", never "1 days" */
ok(/, 1 day before your event\./.test(G.hirerRefundText_('2026-12-18', EV)), 'one day before says "1 day"');
ok(/, 2 days before your event\./.test(G.hirerRefundText_('2026-12-17', EV)), 'two days before says "2 days"');
ok(/, 0 days before your event\./.test(G.hirerRefundText_(EV, EV)), 'on the day says "0 days"');

/* the request acknowledgement and the form mention the fee (the email holds only the club's own words) */
const B0 = (() => { const c = vm.createContext({ window: {} }); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'rules.js'), 'utf8'), c); return c.window.DiaryRules; })();
ok(/£50/.test(B0.REQUEST_PRICE_TEXT) && /do not pay anything now/.test(B0.REQUEST_PRICE_TEXT), 'request wording: £50, nothing to pay now');
const codeText = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
ok(/REQUEST_PRICE_TEXT,\s*\n\s*\['Room: '/.test(codeText), 'the acknowledgement email includes the fee wording');
ok(/Hire is £' \+ R\.PRICE/.test(fs.readFileSync(path.join(__dirname, '..', 'public.js'), 'utf8')), 'the public form shows the price');

/* the hire terms say the same as the code */
const termsMd = fs.readFileSync(path.join(__dirname, '..', 'HIRE-TERMS.md'), 'utf8');
const termsHtml = fs.readFileSync(path.join(__dirname, '..', 'hire-terms.html'), 'utf8');
[[/£50/, 'the fee'], [/£40/, 'the early refund'], [/£10 admin fee/, 'the admin fee'], [/£25/, 'the later refund'], [/80 people/, 'the function room limit'],
  [/50 people/, 'the tea room limit'], [/within 7 days/, 'pay within 7 days'], [/29 days or more/, 'the 28 day boundary'], [/13 days or fewer/, 'the 14 day boundary'],
  [/full refund/, 'club cancellation refund'], [/Music must finish by (\*\*|<b>)11\.30pm/, 'the music finish time'], [/leave the building by (\*\*|<b>)midnight/, 'the leave time']].forEach(([re, what]) => {
  ok(re.test(termsMd), 'HIRE-TERMS.md states ' + what);
  ok(re.test(termsHtml), 'hire-terms.html states ' + what);
});
ok(!/[\u2013\u2014]/.test(termsMd) && !/[\u2013\u2014]|&mdash;|&ndash;/.test(termsHtml), 'no dashes in the hire terms');
const confirmsMd = (termsMd.match(/\[confirm/g) || []).length, confirmsHtml = (termsHtml.match(/\[confirm/g) || []).length;
ok(confirmsMd > 0 && confirmsMd === confirmsHtml, 'the same [confirm] items are marked in both versions (' + confirmsMd + ' and ' + confirmsHtml + ')');
const sectionsMd = (termsMd.match(/^## /gm) || []).length, sectionsHtml = (termsHtml.match(/<h2/g) || []).length;
eq(sectionsHtml, sectionsMd, 'hire-terms.html has the same sections as HIRE-TERMS.md');
// Every numbered clause in HIRE-TERMS.md appears word for word on the web page
const pageText = termsHtml.replace(/<span class="n">([\d.]+)<\/span> /g, '$1 ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const mdLines = termsMd.split(/\r?\n/);
const clauses = mdLines.filter(l => /^\d+\.\d+ /.test(l)).map(l => l.replace(/\*\*/g, '').trim());
ok(clauses.length > 50, 'found the numbered clauses in HIRE-TERMS.md (' + clauses.length + ')');
clauses.forEach(c => ok(pageText.indexOf(c) >= 0, 'hire-terms.html has clause ' + c.slice(0, 60)));
mdLines.filter(l => /^\|/.test(l) && !/^\|---/.test(l)).forEach(l => l.split('|').map(x => x.trim()).filter(Boolean)
  .forEach(cell => ok(pageText.indexOf(cell) >= 0, 'hire-terms.html refund table has ' + cell)));

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
eq(G.capacity_({ 'Room capacity': '200' }), 80, 'capacity cannot be raised above 80');
eq(G.capacity_({ 'Room capacity': '' }), 80, 'blank capacity means 80');
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
  { room: 'tea' }, { room: 'fn' }, { room: '' }, { room: 'Tea room' }, { room: 'toString' }, { room: 'tea', guests: 51 }, { room: 'tea', sess: 'x' },
  { guests: 80 }, { guests: 81 }, { room: 'tea', guests: 50 }, { room: 'tea', guests: 30 }
].forEach((o, i) => {
  const input = Object.assign({}, good, o);
  [75, 100, { fn: 75, tea: 50 }, { fn: 80, tea: 50 }, { fn: 90, tea: 75 }, { fn: 60, tea: 25 }].forEach(c => {
    eq(answer(() => B.validate(input, TODAY, c)), answer(() => G.validateRequest_(input, TODAY, c)), 'browser and server agree on case ' + i + ' with capacity ' + JSON.stringify(c));
  });
});
eq([B.ROOMS.fn.max, B.ROOMS.tea.max], [80, 50], 'browser knows the fire limits 80 and 50');

/* payment and refund wording: browser (demo) and server agree */
['', LINK, 'https://evil.example/x', 'https://buy.stripe.com/test_abc'].forEach(l => ['ECC-AB12CD', '', 'x y'].forEach(ref => ['sarah@example.com', ''].forEach(em => {
  eq(B.paymentUrl(l, ref, em), G.paymentUrl_(l, ref, em), 'browser and server agree on payment url ' + [l, ref, em].join(' | '));
  ['2026-11-15', '2026-11-21', '2027-06-01'].forEach(d => eq(B.paymentText(l, ref, em, '2026-11-14', d), G.paymentText_(l, ref, em, '2026-11-14', d), 'browser and server agree on payment text ' + [l, ref, d].join(' | ')));
})));
['2026-10-01', '2026-11-20', '2026-11-21', '2026-12-05', '2026-12-06', EV].forEach(a => {
  eq(B.refundDue(a, EV), G.refundDue_(a, EV), 'browser and server agree on refund for ' + a);
  eq(B.hirerRefundText(a, EV), G.hirerRefundText_(a, EV), 'browser and server agree on refund wording for ' + a);
});
['', 'x', '2025-01-01', '2025-10-13', '2025-10-14', '2026-09-29', '2026-10-01', '2026-11-14', '2026-11-15', '2026-12-18'].forEach(a =>
  ['', 'rubbish', '2026-10-01 10:00', '2026-09-30'].forEach(rc => ['2026-12-19', '2026-11-10'].forEach(ev =>
    eq(B.askedDateError(a, ev, rc, '2026-11-14'), G.askedDateError_(a, ev, rc, '2026-11-14'), 'browser and server agree on asked date ' + [a, rc, ev].join(' | ')))));
ok(G.confirmationLines_(bk, '', '', '2026-11-14').indexOf(B.CANCEL_TERMS_TEXT) >= 0, 'browser and server have the same cancellation summary');
ok(G.clubCancelLines_(bk, 'x').indexOf(B.CLUB_REFUND_TEXT) >= 0, 'browser and server have the same club refund wording');
ok(codeText.indexOf("const REQUEST_PRICE_TEXT = 'The hire fee is ' + money_(HIRE_PRICE) + '. You do not pay anything now.") >= 0 &&
  B.REQUEST_PRICE_TEXT === 'The hire fee is £50. You do not pay anything now. If the committee approve your booking, we will email you a link to pay by card. Please pay within 7 days of that email.',
  'request fee wording is the same in both copies');
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

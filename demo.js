/* Elsecar Club Diary: demo backend (only loaded with ?demo=1).
   Pretends to be the Apps Script server so the pages can be tried without touching the real diary.
   Sample data is kept in this browser only (localStorage), so the public demo and the committee demo
   share it: send a request on index.html?demo=1, then approve it on committee.html?demo=1.
   Emails are not sent. They are listed in a "demo outbox" on the committee page instead.
   Test switches (add to the page address): quota=low pretends the day's email allowance is nearly used up,
   mailfail=1 pretends every email fails, so the "Needs attention" warning shows,
   nolink=1 pretends the Settings tab has no payment link, so the confirmation email says the club will be in touch. */
(function () {
'use strict';
const R = window.DiaryRules;
const KEY = 'ecc-diary-demo-v6'; // v6: payments and new capacities
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = isoOf(new Date());
const nowText = () => { const d = new Date(); return TODAY + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { const e = new Error(msg); e.userFacing = true; throw e; };
const CATS = ['room', 'club', 'cricket', 'meet', 'staff'];
const FLAGS = new URLSearchParams(location.search);
const LOCKED = 'This is an online booking. To cancel it, use Cancel in the Room bookings card so the customer is told.';
const roomName = R.roomName;
const roomLabel = k => R.ROOMS[k].label;
const CAPS = { fn: R.ROOMS.fn.max, tea: R.ROOMS.tea.max }; // 80 and 50
// Demo only. Clearly fake: the real link is pasted into the Settings tab by Pete. Never a real Stripe link here.
const DEMO_PAYMENT_LINK = 'https://buy.stripe.com/DEMOnotARealPaymentLink';
const DEMO_TERMS_URL = 'https://peterpan6604.github.io/elsecar-diary/hire-terms.html';

let memory = null; // used if this browser blocks storage
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.day === TODAY) return s; } catch (e) {}
  if (memory && memory.day === TODAY) return memory;
  return seed();
}
function save(st) { memory = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

function seed() {
  const st = { day: TODAY, n: 0, fails: 0, events: [], bookings: [], log: [], outbox: [], sent: {}, attention: [] };
  const d = off => R.addDays(TODAY, off);
  const mk = (off, start, end, title, cat, o) => Object.assign({ id: 'demo' + (++st.n), date: d(off), start, end, allDay: false, title, cat,
    src: '', status: 'confirmed', notes: '', pub: cat === 'room' || cat === 'club' || cat === 'cricket', room: cat === 'room', tea: false, by: 'Amanda', bk: '' }, o || {});
  st.events = [
    mk(1, '19:30', '21:00', 'Committee meeting', 'meet', { notes: 'Agenda: Christmas rota, roof quote, room hire prices.' }),
    mk(2, '20:00', '23:00', 'Quiz night', 'club', { tea: true, notes: 'In the tea room. One pound a head, teams of up to 6.' }),
    mk(3, '18:00', '00:00', '40th birthday party', 'room', { notes: 'Own DJ. Buffet from 8pm.', by: 'Sarah' }),
    mk(3, '17:00', '00:00', 'Bar cover needed: 40th birthday', 'staff', { pub: false, notes: 'Two on the bar.' }),
    mk(4, '10:00', '12:00', 'Junior winter nets', 'cricket', { notes: 'Sports hall. U11 to U15.' }),
    mk(6, '11:00', '15:00', 'Christmas craft fair', 'club', { room: true, tea: true, notes: 'Stalls in the function room, the tea room and the bar.' }),
    mk(8, '18:00', '23:00', 'Slimming club', 'club', { tea: true, pub: false, notes: 'Weekly. Tea room only.' }),
    mk(6, '13:00', '17:00', '1st XI v Hoyland Town (H)', 'cricket', { src: 'play-cricket', by: '' }),
    mk(9, '19:30', '23:00', 'Presentation night', 'cricket', { room: true, pub: true }),
    mk(10, '', '', 'Brewery delivery', 'staff', { allDay: true, pub: false }),
    mk(15, '09:00', '12:00', 'Over 60s coffee morning', 'club', { room: true, notes: 'Uses the function room in the morning only.' }),
    mk(21, '19:30', '21:00', 'Committee meeting', 'meet'),
    mk(35, '20:00', '01:00', 'Christmas party night', 'club', { room: true })
  ];
  const bk = (off, sess, type, guests, name, status, o) => Object.assign({ id: 'ECC-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    received: R.addDays(TODAY, -1) + ' 11:05', status, date: d(off), sess, room: 'fn', type, guests: String(guests), name,
    email: name.split(' ')[0].toLowerCase() + '@example.com', phone: '07700 900' + String(100 + st.n++).slice(-3), message: '', by: '', at: '', cal: '', bar: '', reason: '' }, o || {});
  st.bookings = [
    bk(-2, 'eve', 'Anniversary', 30, 'Ruth Walker', 'Pending', { received: R.addDays(TODAY, -12) + ' 19:40' }),
    bk(3, 'aft', 'Funeral wake', 40, 'Margaret Hill', 'Pending', { message: 'For my dad. Sandwiches from our own caterer.' }),
    bk(9, 'eve', 'Birthday party', 50, 'Kev Barnes', 'Pending'),
    bk(12, 'eve', '18th birthday', 60, 'Dave Royston', 'Pending', { message: 'For his son. Asked about a buffet.' }),
    bk(12, 'day', 'Wedding or engagement', 75, 'Chloe Benson', 'Pending'),
    bk(12, 'eve', 'Birthday party', 35, 'Jo Platts', 'Pending', { room: 'tea', message: 'Small family do in the tea room.' }),
    bk(14, 'aft', 'Christening', 30, 'Sam Fox', 'Pending', { room: 'tea' }),
    bk(10, 'aft', 'Christening', 45, 'Lisa Moore', 'Approved', { by: 'Amanda', at: R.addDays(TODAY, -2) + ' 18:10' }),
    bk(10, 'aft', 'Anniversary', 25, 'Pat Dyson', 'Approved', { room: 'tea', by: 'Sarah', at: R.addDays(TODAY, -2) + ' 19:30' })
  ];
  st.bookings.filter(b => b.status === 'Approved').forEach(b => approveInto(st, b, 'Amanda'));
  st.log = [
    { when: R.addDays(TODAY, -1) + ' 16:42', who: 'Amanda', what: 'Added', item: 'Quiz night', date: d(2) },
    { when: R.addDays(TODAY, -1) + ' 09:20', who: 'Sarah', what: 'Edited', item: '40th birthday party', date: d(3) }
  ];
  save(st);
  return st;
}

function approveInto(st, b, who) {
  const s = R.SESSIONS[b.sess];
  const where = ' (' + roomName(b.room) + ')';
  const ev = { id: 'demo' + (++st.n), date: b.date, start: s.start, end: s.end, allDay: false, title: 'Private party' + where, cat: 'room', src: '',
    status: 'confirmed', notes: 'Online booking ' + b.id + ', ' + roomName(b.room) + '. ' + b.type + ', ' + b.guests + ' guests. Contact details are on the committee page.',
    pub: true, room: b.room === 'fn', tea: b.room === 'tea', by: who, bk: b.id };
  const bar = { id: 'demo' + (++st.n), date: b.date, start: s.start, end: s.end, allDay: false, title: 'Bar cover needed: private party' + where, cat: 'staff', src: '',
    status: 'confirmed', notes: 'Bar cover for online booking ' + b.id + ' in the ' + roomName(b.room) + ' (' + b.guests + ' guests).', pub: false, room: false, tea: false, by: who, bk: '' };
  st.events.push(ev, bar);
  b.cal = ev.id; b.bar = bar.id;
}

const roomOf = x => x.room === 'tea' ? 'tea' : 'fn'; // a booking with no room is the function room
/** Uses of one room on a date: approved bookings and committee items ticked for that room. */
const usesOn = (st, date, room) => st.events.filter(e => e.date === date && R.roomsOf(e).indexOf(room) >= 0)
  .map(e => ({ date, sess: R.sessionOf(e.allDay ? '' : e.start, e.end), title: e.cat === 'room' ? 'a booking' : e.title }));
const free = (st, date, sess, room) => !usesOn(st, date, room).some(u => R.clash(u.sess, sess));
function mail(st, to, subject, lines, what, date) {
  if (FLAGS.get('mailfail') === '1') {
    st.attention.unshift({ when: nowText(), item: 'Email not sent: ' + what, date });
    addLog(st, 'Diary', 'Needs attention', 'Email not sent: ' + what, date);
    return false;
  }
  st.outbox.unshift({ when: nowText(), to, subject, body: lines.filter(Boolean).join('\n\n') }); st.outbox = st.outbox.slice(0, 30);
  return true;
}
const details = b => ['Room: ' + roomLabel(roomOf(b)), 'Date: ' + R.niceDate(b.date), 'Session: ' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time, 'Type of event: ' + b.type, 'Guests: ' + b.guests, 'Reference: ' + b.id].join('\n');
function addLog(st, who, what, item, date) { st.log.unshift({ when: nowText(), who, what, item, date }); }
const copy = o => JSON.parse(JSON.stringify(o));
const findBk = (st, id) => { const b = st.bookings.find(x => x.id === id); if (!b) fail('That booking was not found.'); return b; };

async function api(action, p, who) {
  await wait(150);
  p = p || {};
  const st = load();
  const out = run(st, action, p, who || 'Demo');
  save(st);
  return copy(out);
}

function run(st, action, p, who) {
  switch (action) {
    /* ---- committee: same as stage 2 ---- */
    case 'login':
      if (st.fails >= 5) fail('Too many wrong attempts. Try again in 15 minutes.');
      if (!String(p.name || '').trim()) fail('Add your first name so changes show who made them.');
      if (String(p.code).trim() !== 'demo') { st.fails++; fail("That code isn't right. Check with the club secretary."); }
      st.fails = 0;
      return { ok: true, token: 'demo-token', name: String(p.name).trim().slice(0, 40), expires: Date.now() + 30 * 864e5 };
    case 'check': return { ok: true, name: who, feed: 'https://example.invalid/this-is-a-demo-link.ics' };
    case 'list': return { ok: true, events: st.events.filter(e => e.date >= p.from && e.date <= p.to) };
    case 'log': return { ok: true, log: st.log.slice(0, 20) };
    case 'save': {
      const x = p.event || {};
      if (!String(x.title || '').trim()) fail('Give it a name so people know what it is.');
      if (CATS.indexOf(x.cat) < 0) fail('Choose a type for this item.');
      if (!x.date) fail('Choose a date.');
      if (!x.start || !x.end) fail('Add a start and finish time.');
      const stored = x.id ? st.events.find(e => e.id === x.id) : null;
      const use = R.roomsForSave(x, stored || null);
      const rec = { date: x.date, start: x.start, end: x.end, allDay: false, title: x.title.trim().slice(0, 100), cat: x.cat, src: '', status: 'confirmed',
        notes: String(x.notes || '').slice(0, 1000), pub: x.cat === 'room' ? true : !!x.pub, room: use.fn, tea: use.tea, by: who, bk: '' };
      const mine = R.sessionOf(rec.start, rec.end);
      R.roomsOf(rec).forEach(r => {
        const hit = st.events.find(e => e.bk && e.date === rec.date && e.id !== x.id && R.roomsOf(e).indexOf(r) >= 0 && R.clash(R.sessionOf(e.start, e.end), mine));
        if (hit) fail('A customer has booked the ' + roomName(r) + ' that ' + R.SESSIONS[R.sessionOf(hit.start, hit.end)].label.toLowerCase() + ' (' + hit.bk + '). Untick "Uses the ' + roomName(r) + '", or cancel that booking first.');
      });
      if (x.id) {
        const cur = st.events.find(e => e.id === x.id);
        if (!cur) fail('Someone else has deleted this item.');
        if (cur.bk) fail(LOCKED);
        Object.assign(cur, rec); addLog(st, who, 'Edited', rec.title, rec.date); return { ok: true, event: cur };
      }
      rec.id = 'demo' + (++st.n); st.events.push(rec); addLog(st, who, 'Added', rec.title, rec.date);
      return { ok: true, event: rec };
    }
    case 'delete': {
      const i = st.events.findIndex(e => e.id === p.id);
      if (i < 0) fail('Someone else has already deleted this item.');
      if (st.events[i].bk) fail(LOCKED);
      const e = st.events.splice(i, 1)[0]; addLog(st, who, 'Deleted', e.title, e.date); return { ok: true };
    }

    /* ---- public ---- */
    case 'public': {
      const events = [], marks = { fn: {}, tea: {} };
      st.events.filter(e => e.date >= p.from && e.date <= p.to).forEach(e => {
        const rooms = R.roomsOf(e);
        if (e.cat === 'room') events.push({ date: e.date, start: e.start, end: e.end, allDay: e.allDay, cat: 'room', title: 'Private party', rooms });
        else if (e.pub) events.push({ date: e.date, start: e.start, end: e.end, allDay: e.allDay, cat: e.cat, title: e.title });
        const s = R.sessionOf(e.allDay ? '' : e.start, e.end);
        rooms.forEach(r => {
          const t = marks[r][e.date] || (marks[r][e.date] = {});
          if (s === 'day') { t.aft = true; t.eve = true; } else if (s) t[s] = true;
        });
      });
      const taken = {};
      Object.keys(marks).forEach(r => { taken[r] = {}; Object.keys(marks[r]).sort().forEach(d => { taken[r][d] = ['aft', 'eve'].filter(s => marks[r][d][s]); }); });
      return { ok: true, events, taken, roomTaken: taken.fn, rules: { today: TODAY, capacity: CAPS.fn, termsUrl: DEMO_TERMS_URL, minNotice: R.MIN_NOTICE, maxMonths: R.MAX_MONTHS,
        rooms: Object.keys(R.ROOMS).map(k => ({ key: k, label: roomLabel(k), capacity: CAPS[k] })),
        shortNoticeType: R.SHORT_NOTICE_TYPE, types: R.TYPES, privacyContact: '' } };
    }
    case 'request': {
      if (String(p.website || '').trim() || !(Number(p.elapsed) >= 3000)) return { ok: true, ref: '' };
      const dev = String(p.deviceId || 'unknown');
      st.sent[dev] = st.sent[dev] || 0;
      if (st.sent[dev] >= 3) fail("You've sent several requests already. The committee will be in touch.");
      if (FLAGS.get('quota') === 'low') fail("We can't take online requests right now. Please ring the club.");
      const r = R.validate(p, TODAY, CAPS);
      const room = roomName(r.room);
      if (!free(st, r.date, r.sess, r.room)) fail('Sorry, the ' + room + ' is already booked that ' + R.SESSIONS[r.sess].label.toLowerCase() + '. Please choose another date, session or room.');
      if (st.bookings.filter(x => x.status === 'Pending' && x.date >= TODAY && x.email.toLowerCase() === r.email.toLowerCase()).length >= 2) {
        fail('You already have requests waiting for the committee. They will be in touch soon.');
      }
      const rival = st.bookings.some(x => x.status === 'Pending' && roomOf(x) === r.room && x.date === r.date && R.clash(x.sess, r.sess));
      const b = { id: 'ECC-' + Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X'), received: nowText(), status: 'Pending', date: r.date, sess: r.sess, room: r.room,
        type: r.type, guests: String(r.guests), name: r.name, email: r.email, phone: r.phone, message: r.message, by: '', at: '', cal: '', bar: '', reason: '' };
      st.bookings.push(b);
      st.sent[dev]++;
      const sent = mail(st, b.email, 'Your ' + room + ' request (' + b.id + ')', ['Hello,',
        'Thank you for asking to hire the ' + room + ' at Elsecar Sports & Social Club.',
        'This is a request, not a confirmed booking. The committee will look at it and be in touch. Please do not make firm plans until you hear from us.',
        R.REQUEST_PRICE_TEXT,
        ['Room: ' + roomLabel(b.room), 'Date: ' + R.niceDate(b.date), 'Session: ' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time, 'Reference: ' + b.id].join('\n'),
        'If you did not send this request, you can ignore this email.', 'Elsecar Sports & Social Club'], 'Acknowledgement to customer (' + b.id + ')', b.date);
      mail(st, 'every committee address in Settings', roomLabel(b.room) + ' request: ' + R.niceDate(b.date) + ', ' + R.SESSIONS[b.sess].label.toLowerCase() + ' (' + b.id + ')', [
        'A new ' + room + ' request has come in from the website.', details(b), rival ? 'Clash: Another request is already waiting for this session.' : '',
        'Sign in to the club diary to see the contact details, then approve or decline it.', 'It is not a booking until a committee member approves it.'], 'Committee alert (' + b.id + ')', b.date);
      return { ok: true, ref: b.id, emailed: sent };
    }

    /* ---- committee: bookings ---- */
    case 'bookings': {
      const rows = st.bookings.filter(x => x.date >= TODAY);
      const pending = rows.filter(x => x.status === 'Pending').sort((a, b) => (a.date + a.sess).localeCompare(b.date + b.sess));
      const past = st.bookings.filter(x => x.status === 'Pending' && x.date < TODAY).map(x => Object.assign({}, x, { past: true, clash: '' }));
      const pend = pending.map(x => {
        const room = roomOf(x);
        const notes = usesOn(st, x.date, room).filter(u => R.clash(u.sess, x.sess)).map(u => 'The ' + roomName(room) + ' is already in use that day: ' + u.title + ' (' + R.SESSIONS[u.sess].label.toLowerCase() + ').');
        const others = pending.filter(o => o.id !== x.id && roomOf(o) === room && o.date === x.date && R.clash(o.sess, x.sess));
        if (others.length === 1) notes.push('Another request wants this session too (' + others[0].id + ').');
        else if (others.length > 1) notes.push(others.length + ' other requests want this session too.');
        return Object.assign({}, x, { clash: notes.join(' ') });
      });
      return { ok: true, pending: past.concat(pend), attention: st.attention.slice(0, 10), upcoming: rows.filter(x => x.status === 'Approved').sort((a, b) => (a.date + a.sess).localeCompare(b.date + b.sess)),
        outbox: st.outbox.slice(0, 8) };
    }
    case 'approve': {
      const b = findBk(st, p.id);
      if (b.status !== 'Pending') fail('This request has already been ' + b.status.toLowerCase() + '.');
      if (b.date < TODAY) fail('The date of this request has passed. Decline it instead.');
      b.room = roomOf(b);
      if (!(Number(b.guests) <= CAPS[b.room])) fail('This request is for ' + b.guests + ' guests, but the ' + roomName(b.room) + ' holds up to ' + CAPS[b.room] +
        '. Ask the customer if they can bring their numbers down (then change Guests in the Bookings tab), or decline it.');
      const busy = 'The ' + roomName(b.room) + ' is no longer free that ' + R.SESSIONS[b.sess].label.toLowerCase() + '. Decline this request, or cancel the other booking first.';
      if (!free(st, b.date, b.sess, b.room)) fail(busy);
      approveInto(st, b, who);
      Object.assign(b, { status: 'Approved', by: who, at: nowText() });
      addLog(st, who, 'Approved booking', b.type + ' (' + b.id + ')', b.date);
      const sent = mail(st, b.email, 'Your ' + roomName(b.room) + ' booking is confirmed (' + b.id + ')', ['Hello ' + b.name + ',',
        'Good news. Your ' + roomName(b.room) + ' booking at Elsecar Sports & Social Club is confirmed.', details(b),
        R.paymentText(FLAGS.get('nolink') === '1' ? '' : DEMO_PAYMENT_LINK, b.id, b.email, TODAY, b.date),
        'Please read the hire terms before your event. They are part of your booking:\n' + DEMO_TERMS_URL,
        R.CANCEL_TERMS_TEXT, 'Elsecar Sports & Social Club'], 'Confirmation to customer (' + b.id + ')', b.date);
      return { ok: true, emailed: sent };
    }
    case 'decline': {
      const b = findBk(st, p.id);
      if (b.status !== 'Pending') fail('This request is already ' + b.status.toLowerCase() + '.');
      const why = R.clean(p.reason, 500, true);
      Object.assign(b, { status: 'Declined', by: who, at: nowText(), reason: why });
      addLog(st, who, 'Declined request', b.type + ' (' + b.id + ')', b.date);
      const sent = mail(st, b.email, 'Your ' + roomName(roomOf(b)) + ' request (' + b.id + ')', ['Hello ' + b.name + ',',
        'Thank you for your request. Sorry, the club cannot take your booking for the ' + roomName(roomOf(b)) + ' on ' + R.niceDate(b.date) + ' (' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time + ').',
        why ? 'The committee said: ' + why : '', 'You are welcome to send a request for another date.', 'Elsecar Sports & Social Club'], 'Decline to customer (' + b.id + ')', b.date);
      return { ok: true, emailed: sent };
    }
    case 'cancel': {
      if (p.who !== 'club' && p.who !== 'hirer') fail('Please refresh the committee page and try again.');
      const why = R.clean(p.reason, 500, true);
      const byHirer = p.who === 'hirer';
      const asked = byHirer ? String(p.asked || '') : '';
      if (!byHirer && why.length < 3) fail('Add a reason. It goes in the email to the customer.');
      const b = findBk(st, p.id);
      if (b.status !== 'Approved') fail('This booking is already ' + b.status.toLowerCase() + '.');
      const badDate = byHirer ? R.askedDateError(asked, b.date, b.received, TODAY) : '';
      if (badDate) fail(badDate);
      st.events = st.events.filter(e => e.id !== b.cal && e.id !== b.bar);
      const refund = byHirer ? R.refundDue(asked, b.date) : R.PRICE;
      Object.assign(b, { status: 'Cancelled', by: who, at: nowText(), reason: byHirer ? 'Customer asked on ' + asked + '. Refund due if paid: £' + refund + (why ? '. ' + why : '') : 'Cancelled by the club. Full refund if paid. ' + why });
      addLog(st, who, byHirer ? 'Cancelled booking (customer asked)' : 'Cancelled booking', b.type + ' (' + b.id + ')', b.date);
      const when = R.niceDate(b.date) + ' (' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time + ')';
      const lines = byHirer
        ? ['Hello ' + b.name + ',', 'As you asked, we have cancelled your ' + roomName(roomOf(b)) + ' booking on ' + when + '.',
          why ? 'The committee said: ' + why : '', R.hirerRefundText(asked, b.date), 'Please reply to this email if you have any questions.', 'Elsecar Sports & Social Club']
        : ['Hello ' + b.name + ',', 'Sorry, the club has had to cancel your ' + roomName(roomOf(b)) + ' booking on ' + when + '.',
          'Reason: ' + why, R.CLUB_REFUND_TEXT, 'We are sorry for the trouble this causes. Please reply to this email if you have any questions.', 'Elsecar Sports & Social Club'];
      const sent = mail(st, b.email, 'Your ' + roomName(roomOf(b)) + ' booking has been cancelled (' + b.id + ')', lines, 'Cancellation to customer (' + b.id + ')', b.date);
      return { ok: true, emailed: sent, refund };
    }
  }
  fail('Unknown action.');
}

function reset() { try { localStorage.removeItem(KEY); } catch (e) {} memory = null; }

window.DiaryDemo = { api, reset };
})();

/* Elsecar Club Diary: demo backend (only loaded with ?demo=1).
   Pretends to be the Apps Script server so the pages can be tried without touching the real diary.
   Sample data is kept in this browser only (localStorage), so the public demo and the committee demo
   share it: send a request on index.html?demo=1, then approve it on committee.html?demo=1.
   Emails are not sent. They are listed in a "demo outbox" on the committee page instead. */
(function () {
'use strict';
const R = window.DiaryRules;
const KEY = 'ecc-diary-demo-v3';
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = isoOf(new Date());
const nowText = () => { const d = new Date(); return TODAY + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { const e = new Error(msg); e.userFacing = true; throw e; };
const CATS = ['room', 'club', 'cricket', 'meet', 'staff'];
const LOCKED = 'This is an online booking. To cancel it, use Cancel in the Function room bookings card so the customer is told.';

let memory = null; // used if this browser blocks storage
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.day === TODAY) return s; } catch (e) {}
  if (memory && memory.day === TODAY) return memory;
  return seed();
}
function save(st) { memory = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

function seed() {
  const st = { day: TODAY, n: 0, fails: 0, events: [], bookings: [], log: [], outbox: [], sent: {} };
  const d = off => R.addDays(TODAY, off);
  const mk = (off, start, end, title, cat, o) => Object.assign({ id: 'demo' + (++st.n), date: d(off), start, end, allDay: false, title, cat,
    src: '', status: 'confirmed', notes: '', pub: cat === 'room' || cat === 'club' || cat === 'cricket', room: cat === 'room', by: 'Amanda', bk: '' }, o || {});
  st.events = [
    mk(1, '19:30', '21:00', 'Committee meeting', 'meet', { notes: 'Agenda: Christmas rota, roof quote, function room prices.' }),
    mk(2, '20:00', '23:00', 'Quiz night', 'club', { notes: 'One pound a head, teams of up to 6.' }),
    mk(3, '18:00', '00:00', '40th birthday party', 'room', { notes: 'Own DJ. Buffet from 8pm.', by: 'Sarah' }),
    mk(3, '17:00', '00:00', 'Bar cover needed: 40th birthday', 'staff', { pub: false, notes: 'Two on the bar.' }),
    mk(4, '10:00', '12:00', 'Junior winter nets', 'cricket', { notes: 'Sports hall. U11 to U15.' }),
    mk(6, '11:00', '15:00', 'Christmas craft fair', 'club', { room: true, notes: 'Stalls in the function room and bar.' }),
    mk(6, '13:00', '17:00', '1st XI v Hoyland Town (H)', 'cricket', { src: 'play-cricket', by: '' }),
    mk(9, '19:30', '23:00', 'Presentation night', 'cricket', { room: true, pub: true }),
    mk(10, '', '', 'Brewery delivery', 'staff', { allDay: true, pub: false }),
    mk(21, '19:30', '21:00', 'Committee meeting', 'meet'),
    mk(35, '20:00', '01:00', 'Christmas party night', 'club', { room: true })
  ];
  const bk = (off, sess, type, guests, name, status, o) => Object.assign({ id: 'ECC-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    received: R.addDays(TODAY, -1) + ' 11:05', status, date: d(off), sess, type, guests: String(guests), name,
    email: name.split(' ')[0].toLowerCase() + '@example.com', phone: '07700 900' + String(100 + st.n++).slice(-3), message: '', by: '', at: '', cal: '', bar: '', reason: '' }, o || {});
  st.bookings = [
    bk(3, 'aft', 'Funeral wake', 40, 'Margaret Hill', 'Pending', { message: 'For my dad. Sandwiches from our own caterer.' }),
    bk(9, 'eve', 'Birthday party', 50, 'Kev Barnes', 'Pending'),
    bk(12, 'eve', '18th birthday', 60, 'Dave Royston', 'Pending', { message: 'For his son. Asked about a buffet.' }),
    bk(12, 'day', 'Wedding or engagement', 75, 'Chloe Benson', 'Pending'),
    bk(10, 'aft', 'Christening', 45, 'Lisa Moore', 'Approved', { by: 'Amanda', at: R.addDays(TODAY, -2) + ' 18:10' })
  ];
  approveInto(st, st.bookings[4], 'Amanda');
  st.log = [
    { when: R.addDays(TODAY, -1) + ' 16:42', who: 'Amanda', what: 'Added', item: 'Quiz night', date: d(2) },
    { when: R.addDays(TODAY, -1) + ' 09:20', who: 'Sarah', what: 'Edited', item: '40th birthday party', date: d(3) }
  ];
  save(st);
  return st;
}

function approveInto(st, b, who) {
  const s = R.SESSIONS[b.sess];
  const ev = { id: 'demo' + (++st.n), date: b.date, start: s.start, end: s.end, allDay: false, title: 'Private party', cat: 'room', src: '',
    status: 'confirmed', notes: 'Online booking ' + b.id + '. ' + b.type + ', ' + b.guests + ' guests. Contact details are on the committee page.',
    pub: true, room: true, by: who, bk: b.id };
  const bar = { id: 'demo' + (++st.n), date: b.date, start: s.start, end: s.end, allDay: false, title: 'Bar cover needed: private party', cat: 'staff', src: '',
    status: 'confirmed', notes: 'Bar cover for online booking ' + b.id + ' (' + b.guests + ' guests).', pub: false, room: false, by: who, bk: '' };
  st.events.push(ev, bar);
  b.cal = ev.id; b.bar = bar.id;
}

const usesRoom = e => e.cat === 'room' || e.room;
const usesOn = (st, date) => st.events.filter(e => e.date === date && usesRoom(e)).map(e => ({ date, sess: R.sessionOf(e.allDay ? '' : e.start, e.end), title: e.cat === 'room' ? 'a booking' : e.title }));
const free = (st, date, sess) => !usesOn(st, date).some(u => R.clash(u.sess, sess));
function mail(st, to, subject, lines) { st.outbox.unshift({ when: nowText(), to, subject, body: lines.filter(Boolean).join('\n\n') }); st.outbox = st.outbox.slice(0, 30); }
const details = b => ['Date: ' + R.niceDate(b.date), 'Session: ' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time, 'Type of event: ' + b.type, 'Guests: ' + b.guests, 'Reference: ' + b.id].join('\n');
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
      const rec = { date: x.date, start: x.start, end: x.end, allDay: false, title: x.title.trim().slice(0, 100), cat: x.cat, src: '', status: 'confirmed',
        notes: String(x.notes || '').slice(0, 1000), pub: x.cat === 'room' ? true : !!x.pub, room: x.cat === 'room' || !!x.room, by: who, bk: '' };
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
      const events = [], taken = {};
      st.events.filter(e => e.date >= p.from && e.date <= p.to).forEach(e => {
        if (e.cat === 'room') events.push({ date: e.date, start: e.start, end: e.end, allDay: e.allDay, cat: 'room', title: 'Private party' });
        else if (e.pub) events.push({ date: e.date, start: e.start, end: e.end, allDay: e.allDay, cat: e.cat, title: e.title });
        if (usesRoom(e)) {
          const s = R.sessionOf(e.allDay ? '' : e.start, e.end), t = taken[e.date] || (taken[e.date] = {});
          if (s === 'day') { t.aft = true; t.eve = true; } else t[s] = true;
        }
      });
      const roomTaken = {};
      Object.keys(taken).sort().forEach(d => { roomTaken[d] = ['aft', 'eve'].filter(s => taken[d][s]); });
      return { ok: true, events, roomTaken, rules: { today: TODAY, capacity: 75, termsUrl: '', minNotice: R.MIN_NOTICE, maxMonths: R.MAX_MONTHS,
        shortNoticeType: R.SHORT_NOTICE_TYPE, types: R.TYPES } };
    }
    case 'request': {
      if (String(p.website || '').trim() || !(Number(p.elapsed) >= 3000)) return { ok: true, ref: '' };
      const dev = String(p.deviceId || 'unknown');
      st.sent[dev] = st.sent[dev] || 0;
      if (st.sent[dev] >= 3) fail("You've sent several requests already. The committee will be in touch.");
      const r = R.validate(p, TODAY, 75);
      if (!free(st, r.date, r.sess)) fail('Sorry, the function room is already booked that ' + R.SESSIONS[r.sess].label.toLowerCase() + '. Please choose another date or session.');
      if (st.bookings.filter(x => x.status === 'Pending' && x.date >= TODAY && x.email.toLowerCase() === r.email.toLowerCase()).length >= 2) {
        fail('You already have requests waiting for the committee. They will be in touch soon.');
      }
      const rival = st.bookings.some(x => x.status === 'Pending' && x.date === r.date && R.clash(x.sess, r.sess));
      const b = { id: 'ECC-' + Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X'), received: nowText(), status: 'Pending', date: r.date, sess: r.sess,
        type: r.type, guests: String(r.guests), name: r.name, email: r.email, phone: r.phone, message: r.message, by: '', at: '', cal: '', bar: '', reason: '' };
      st.bookings.push(b);
      st.sent[dev]++;
      mail(st, b.email, 'Your function room request (' + b.id + ')', ['Hello ' + b.name + ',',
        'Thank you for asking to hire the function room at Elsecar Sports & Social Club.',
        'This is a request, not a confirmed booking. The committee will look at it and be in touch. Please do not make firm plans until you hear from us.',
        details(b), 'Elsecar Sports & Social Club']);
      mail(st, 'every committee address in Settings', 'Function room request: ' + R.niceDate(b.date) + ', ' + R.SESSIONS[b.sess].label.toLowerCase() + ' (' + b.id + ')', [
        'A new function room request has come in from the website.', details(b), rival ? 'Clash: Another request is already waiting for this session.' : '',
        'Sign in to the club diary to see the contact details, then approve or decline it.', 'It is not a booking until a committee member approves it.']);
      return { ok: true, ref: b.id, emailed: true };
    }

    /* ---- committee: bookings ---- */
    case 'bookings': {
      const rows = st.bookings.filter(x => x.date >= TODAY);
      const pending = rows.filter(x => x.status === 'Pending').sort((a, b) => (a.date + a.sess).localeCompare(b.date + b.sess));
      const pend = pending.map(x => {
        const notes = usesOn(st, x.date).filter(u => R.clash(u.sess, x.sess)).map(u => 'The room is already in use that day: ' + u.title + ' (' + R.SESSIONS[u.sess].label.toLowerCase() + ').');
        const others = pending.filter(o => o.id !== x.id && o.date === x.date && R.clash(o.sess, x.sess));
        if (others.length === 1) notes.push('Another request wants this session too (' + others[0].id + ').');
        else if (others.length > 1) notes.push(others.length + ' other requests want this session too.');
        return Object.assign({}, x, { clash: notes.join(' ') });
      });
      return { ok: true, pending: pend, upcoming: rows.filter(x => x.status === 'Approved').sort((a, b) => (a.date + a.sess).localeCompare(b.date + b.sess)),
        outbox: st.outbox.slice(0, 8) };
    }
    case 'approve': {
      const b = findBk(st, p.id);
      if (b.status !== 'Pending') fail('This request has already been ' + b.status.toLowerCase() + '.');
      if (b.date < TODAY) fail('The date of this request has passed. Decline it instead.');
      const busy = 'The function room is no longer free that ' + R.SESSIONS[b.sess].label.toLowerCase() + '. Decline this request, or cancel the other booking first.';
      if (!free(st, b.date, b.sess)) fail(busy);
      approveInto(st, b, who);
      Object.assign(b, { status: 'Approved', by: who, at: nowText() });
      addLog(st, who, 'Approved booking', b.type + ' (' + b.id + ')', b.date);
      mail(st, b.email, 'Your function room booking is confirmed (' + b.id + ')', ['Hello ' + b.name + ',',
        'Good news. Your function room booking at Elsecar Sports & Social Club is confirmed.', details(b),
        'The club will send you the hire terms before your event.', 'If you need to change or cancel, please tell us as soon as you can by replying to this email.',
        'Elsecar Sports & Social Club']);
      return { ok: true, emailed: true };
    }
    case 'decline': {
      const b = findBk(st, p.id);
      if (b.status !== 'Pending') fail('This request is already ' + b.status.toLowerCase() + '.');
      const why = R.clean(p.reason, 500, true);
      Object.assign(b, { status: 'Declined', by: who, at: nowText(), reason: why });
      addLog(st, who, 'Declined request', b.type + ' (' + b.id + ')', b.date);
      mail(st, b.email, 'Your function room request (' + b.id + ')', ['Hello ' + b.name + ',',
        'Thank you for your request. Sorry, the club cannot take your booking for the function room on ' + R.niceDate(b.date) + ' (' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time + ').',
        why ? 'The committee said: ' + why : '', 'You are welcome to send a request for another date.', 'Elsecar Sports & Social Club']);
      return { ok: true, emailed: true };
    }
    case 'cancel': {
      const why = R.clean(p.reason, 500, true);
      if (why.length < 3) fail('Add a reason. It goes in the email to the customer.');
      const b = findBk(st, p.id);
      if (b.status !== 'Approved') fail('This booking is already ' + b.status.toLowerCase() + '.');
      st.events = st.events.filter(e => e.id !== b.cal && e.id !== b.bar);
      Object.assign(b, { status: 'Cancelled', by: who, at: nowText(), reason: why });
      addLog(st, who, 'Cancelled booking', b.type + ' (' + b.id + ')', b.date);
      mail(st, b.email, 'Your function room booking has been cancelled (' + b.id + ')', ['Hello ' + b.name + ',',
        'Sorry, the club has had to cancel your function room booking on ' + R.niceDate(b.date) + ' (' + R.SESSIONS[b.sess].label + ', ' + R.SESSIONS[b.sess].time + ').',
        'Reason: ' + why, 'We are sorry for the trouble this causes. Please reply to this email if you have any questions.', 'Elsecar Sports & Social Club']);
      return { ok: true, emailed: true };
    }
  }
  fail('Unknown action.');
}

function reset() { try { localStorage.removeItem(KEY); } catch (e) {} memory = null; }

window.DiaryDemo = { api, reset };
})();

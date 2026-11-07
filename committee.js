/* Elsecar Club Diary: committee view.
   Plain JavaScript, no libraries. All text from the server is put on the page with
   textContent / text nodes (never innerHTML), so nothing typed into the diary can run as code.
   The server checks every request; this page is never trusted. */
(function () {
'use strict';

const CFG = window.DIARY_CONFIG || {};
const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const DEMO_OFFLINE = DEMO && QS.get('offline') === '1'; // test aid: pretend there is no signal
const HAS_BACKEND = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(CFG.BACKEND_URL || '');

const CATS = {
  room:    { label: 'Function room hire', c: 'var(--c-room)' },
  club:    { label: 'Club events',        c: 'var(--c-club)' },
  cricket: { label: 'Cricket',            c: 'var(--c-cricket)' },
  meet:    { label: 'Committee',          c: 'var(--c-meet)' },
  staff:   { label: 'Bar & staffing',     c: 'var(--c-staff)' }
};
const SESS_LABEL = { aft: 'afternoon', eve: 'evening', day: 'whole day' };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const LIST_DAYS = 90; // the server allows 100 at most

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = d => iso(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return isoOf(d); };
const nice = s => { const d = parse(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const short = s => { const d = parse(s); return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); };
const TODAY = isoOf(new Date());

/** Builds an element. Children that are strings become text nodes. */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'c') n.style.setProperty('--c', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
function fill(node, ...kids) { node.replaceChildren(...kids.flat(Infinity).filter(Boolean)); }

function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {} return null; }

/* ---------- state ---------- */
const now = new Date();
const S = {
  session: null,          // { token, name, expires }
  view: 'month',          // 'month' | 'list'
  y: now.getFullYear(), m: now.getMonth(), sel: TODAY,
  off: new Set(),         // categories hidden by the filter chips
  events: [], log: [], feed: '', loadErr: '', loading: false,
  pending: [], upcoming: [], outbox: [], bkLoaded: false, bkErr: '' // function room requests (stage 3)
};
let reqId = 0;

/* ---------- talking to the server ---------- */
class ApiError extends Error { constructor(msg, auth) { super(msg); this.auth = !!auth; } }

async function api(action, payload) {
  if (DEMO) return demoApi(action, payload || {});
  const body = Object.assign({ action }, payload || {});
  if (S.session) body.token = S.session.token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let data;
  try {
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    const res = await fetch(CFG.BACKEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    data = await res.json();
  } catch (e) {
    if (e && e.name === 'SyntaxError') throw new ApiError("The diary didn't answer properly. Try again in a minute.");
    throw new ApiError("Can't reach the diary. Check your signal or wifi and try again. Nothing was changed.");
  } finally { clearTimeout(timer); }
  if (!data || data.ok !== true) {
    const err = new ApiError((data && data.error) || 'Something went wrong. Try again in a minute.', data && data.auth);
    if (err.auth) signOut('Please enter the diary code again.');
    throw err;
  }
  return data;
}

/* ---------- sign in / out ---------- */
function showOnly(which) {
  $('signin').hidden = which !== 'signin';
  $('noBackend').hidden = which !== 'noBackend';
  $('app').hidden = which !== 'app';
  fill($('who'));
  if (which === 'app') {
    $('who').append(h('span', null, 'Signed in as ', h('b', null, S.session.name)), h('button', { class: 'pill', onclick: () => { signOut(); toast('Signed out'); } }, 'Sign out'));
  }
}

function signOut(message) {
  S.session = null; S.events = []; S.log = []; S.feed = ''; S.pending = []; S.upcoming = []; S.outbox = []; S.bkLoaded = false;
  store('ecc-diary-session', null);
  closeModal();
  showSignin(message);
}

function showSignin(message) {
  showOnly('signin');
  $('inName').value = store('ecc-diary-name') || '';
  $('inCode').value = '';
  setErr($('inErr'), message || '');
  (($('inName').value) ? $('inCode') : $('inName')).focus();
}

function setErr(node, msg) { node.textContent = msg || ''; node.hidden = !msg; }

function deviceId() {
  let id = store('ecc-diary-device');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)); store('ecc-diary-device', id); }
  return id;
}

$('signinForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('inName').value.trim(), code = $('inCode').value;
  if (!name) return setErr($('inErr'), 'Add your first name so changes show who made them.');
  if (!code.trim()) return setErr($('inErr'), 'Enter the diary code.');
  setErr($('inErr'), ''); $('inGo').disabled = true; $('inGo').textContent = 'Checking…';
  try {
    const r = await api('login', { name, code, deviceId: deviceId() });
    S.session = { token: r.token, name: r.name, expires: r.expires };
    store('ecc-diary-name', r.name);
    if (!DEMO) store('ecc-diary-session', JSON.stringify(S.session));
    $('inCode').value = '';
    startApp();
  } catch (e) { setErr($('inErr'), e.message); }
  $('inGo').disabled = false; $('inGo').textContent = 'Open diary';
});

/* ---------- loading data ---------- */
function gridRange() {
  const lead = (new Date(S.y, S.m, 1).getDay() + 6) % 7;
  const cells = Math.ceil((lead + new Date(S.y, S.m + 1, 0).getDate()) / 7) * 7;
  const start = new Date(S.y, S.m, 1 - lead);
  const end = new Date(S.y, S.m, 1 - lead + cells - 1);
  return [start, end, cells];
}
function currentRange() {
  if (S.view === 'list') return [TODAY, addDays(TODAY, LIST_DAYS - 1)];
  const [a, b] = gridRange();
  return [isoOf(a), isoOf(b)];
}

async function load() {
  const my = ++reqId;
  const [from, to] = currentRange();
  S.loading = true; $('mainCol').classList.add('loading');
  try {
    const r = await api('list', { from, to });
    if (my !== reqId) return;
    S.events = r.events || []; S.loadErr = '';
  } catch (e) {
    if (my !== reqId) return;
    if (e.auth) return;
    S.loadErr = e.message;
  }
  S.loading = false; $('mainCol').classList.remove('loading');
  render();
}

async function loadLog() {
  try { S.log = (await api('log')).log || []; renderSide(); } catch (e) { /* the log is a nice extra; ignore */ }
}

async function loadFeed() {
  try { S.feed = (await api('check')).feed || ''; renderSide(); } catch (e) { /* ignore */ }
}

async function loadBookings() {
  try {
    const r = await api('bookings');
    S.pending = r.pending || []; S.upcoming = r.upcoming || []; S.outbox = r.outbox || []; S.bkErr = '';
  } catch (e) { if (e.auth) return; S.bkErr = e.message; }
  S.bkLoaded = true;
  renderSide();
}

function startApp() {
  showOnly('app');
  render();
  load(); loadLog(); loadFeed(); loadBookings();
}

// Coming back to the page (another tab, or the phone was locked): fetch new requests.
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) { loadBookings(); } });

/* ---------- display ---------- */
const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.title.localeCompare(b.title);
const visible = () => S.events.filter(e => !S.off.has(e.cat));
const eventsOn = d => visible().filter(e => e.date === d).sort(byTime);
const timeText = e => e.allDay || !e.start ? 'All day' : e.start + ' to ' + e.end;
const isFixture = e => e.src === 'play-cricket';

function render() {
  $('vMonth').setAttribute('aria-pressed', S.view === 'month');
  $('vList').setAttribute('aria-pressed', S.view === 'list');
  $('monthNav').hidden = S.view !== 'month';
  $('listLabel').hidden = S.view !== 'list';
  $('calBox').hidden = S.view !== 'month';
  $('listBox').hidden = S.view !== 'list';
  $('monthLabel').textContent = MONTHS[S.m] + ' ' + S.y;
  setErr($('loadErr'), '');
  if (S.loadErr) {
    $('loadErr').hidden = false;
    fill($('loadErr'), S.loadErr + ' ', h('button', { class: 'btn small line', onclick: load }, 'Try again'));
  }
  renderLegend();
  if (S.view === 'month') renderGrid(); else renderList();
  renderSide();
}

function renderLegend() {
  fill($('legend'), Object.keys(CATS).map(k =>
    h('button', { class: 'chip', c: CATS[k].c, 'aria-pressed': String(!S.off.has(k)), onclick: () => { S.off.has(k) ? S.off.delete(k) : S.off.add(k); render(); } },
      h('i'), CATS[k].label)));
}

function renderGrid() {
  const [start, , cells] = gridRange();
  const cellsOut = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoOf(d);
    const evs = eventsOn(key);
    cellsOut.push(h('button', {
      class: 'day' + (d.getMonth() !== S.m ? ' out' : '') + (key === TODAY ? ' today' : '') + (key === S.sel ? ' sel' : ''),
      'aria-label': nice(key) + ', ' + evs.length + (evs.length === 1 ? ' item' : ' items'),
      'aria-pressed': String(key === S.sel),
      onclick: () => { S.sel = key; const x = parse(key); if (x.getMonth() !== S.m) { S.y = x.getFullYear(); S.m = x.getMonth(); load(); } render(); }
    },
      h('span', { class: 'num' }, h('b', null, d.getDate())),
      h('span', { class: 'evs' },
        evs.slice(0, 3).map(e => h('span', { class: 'ev', c: CATS[e.cat].c }, h('span', { class: 't' }, e.allDay ? '' : e.start), e.title)),
        evs.length > 3 ? h('span', { class: 'more' }, '+' + (evs.length - 3) + ' more') : null)));
  }
  fill($('grid'), cellsOut);
}

function renderList() {
  const evs = visible().filter(e => e.date >= TODAY).sort(byTime);
  if (!evs.length) { fill($('listBox'), h('div', { class: 'card' }, h('p', { class: 'empty' }, S.loading ? 'Loading…' : 'Nothing in the diary for the next 3 months.'))); return; }
  const days = [];
  evs.forEach(e => { let g = days[days.length - 1]; if (!g || g.date !== e.date) days.push(g = { date: e.date, items: [] }); g.items.push(e); });
  fill($('listBox'), days.map(g =>
    h('div', { class: 'listday' + (g.date === TODAY ? ' today' : '') },
      h('h3', null, g.date === TODAY ? 'Today, ' + nice(g.date) : nice(g.date)),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, g.items.map(itemEl))))));
}

function itemEl(e) {
  const tags = [];
  if (isFixture(e)) tags.push(h('span', { class: 'tag pc' }, 'Play-Cricket'));
  if (e.bk) tags.push(h('span', { class: 'tag' }, 'Online booking'));
  if (e.room && e.cat !== 'room') tags.push(h('span', { class: 'tag' }, 'Uses room'));
  if (!e.pub && e.cat !== 'room' && !isFixture(e)) tags.push(h('span', { class: 'tag' }, 'Committee only'));
  const meta = timeText(e) + (e.by ? ' · added by ' + e.by : '');
  return h('li', { class: 'item' },
    h('span', { class: 'bar', c: CATS[e.cat].c }),
    h('button', { class: 'linkish', onclick: () => openEditor(e), 'aria-label': 'Open ' + e.title + ', ' + nice(e.date) },
      h('div', { class: 'ttl' }, e.title, tags),
      h('div', { class: 'meta' }, meta),
      e.notes ? h('div', { class: 'note' }, e.notes) : null));
}

function renderSide() {
  const cards = [];
  if (S.view === 'month') {
    const evs = eventsOn(S.sel);
    cards.push(h('div', { class: 'card' },
      h('h3', null, nice(S.sel)),
      h('p', { class: 'sub' }, evs.length ? evs.length + (evs.length === 1 ? ' item. Tap one to edit.' : ' items. Tap one to edit.') : 'Nothing in the diary.'),
      evs.length ? h('ul', { class: 'list' }, evs.map(itemEl)) : null,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn small', onclick: () => openEditor(null) }, 'Add to this day'))));
  }

  cards.push(pendingCard(), upcomingCard());
  if (DEMO && S.outbox.length) cards.push(outboxCard());

  cards.push(h('div', { class: 'card' }, h('h3', null, 'Recent changes'),
    S.log.length
      ? h('ul', { class: 'log' }, S.log.slice(0, 8).map(l => h('li', null, h('b', null, l.who), ' ' + l.what.toLowerCase() + ' ', l.item, l.date ? ' (' + short(l.date) + ')' : '', ' · ' + whenText(l.when))))
      : h('p', { class: 'empty' }, 'No changes yet.')));

  if (S.feed) {
    cards.push(h('div', { class: 'card' }, h('h3', null, 'On your phone'),
      h('p', { class: 'sub' }, 'Add this link to your phone\'s calendar app once and diary changes appear there. Keep it to the committee only. See the guide for the steps.'),
      h('div', { class: 'feed' }, S.feed),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn line small', onclick: copyFeed }, 'Copy link'))));
  }
  fill($('side'), cards);
}

/* ---------- function room requests and bookings (stage 3) ----------
   Contact details only ever appear here, behind sign-in. They are never put in the calendar. */
const SESS_NAME = { aft: 'Afternoon (12pm to 5pm)', eve: 'Evening (6pm to midnight)', day: 'Whole day (12pm to midnight)' };
const bkMeta = b => short(b.date) + ' · ' + (SESS_NAME[b.sess] || '') + ' · ' + b.guests + ' guests';

function contactEl(b) {
  return h('div', { class: 'contact' },
    h('div', null, h('b', null, b.name)),
    h('div', null, h('a', { href: 'tel:' + String(b.phone).replace(/[^0-9+]/g, '') }, b.phone)),
    h('div', null, h('a', { href: 'mailto:' + encodeURIComponent(b.email).replace(/%40/g, '@') }, b.email)));
}

function bkCardBody(list, emptyText, itemFn) {
  if (S.bkErr) return h('p', { class: 'err' }, S.bkErr + ' ', h('button', { class: 'btn small line', onclick: loadBookings }, 'Try again'));
  if (!S.bkLoaded) return h('p', { class: 'empty' }, 'Loading…');
  return list.length ? h('div', { class: 'reqs' }, list.map(itemFn)) : h('p', { class: 'empty' }, emptyText);
}

function viewDate(d) { S.view = 'month'; goToDate(d); window.scrollTo(0, 0); }

function pendingCard() {
  return h('div', { class: 'card', id: 'needsApproval' },
    h('div', { class: 'row spread' }, h('h3', { style: 'margin:0' }, 'Needs approval'),
      S.pending.length ? h('span', { class: 'tag pend' }, S.pending.length + ' waiting') : null),
    h('p', { class: 'sub', style: 'margin-top:4px' }, 'Function room requests from the website. A request does not block the date until you approve it.'),
    bkCardBody(S.pending, 'Nothing waiting.', b => h('div', { class: 'req' + (b.clash ? ' clash' : '') },
      h('div', { class: 'ttl' }, b.type, h('span', { class: 'ref' }, b.id)),
      h('div', { class: 'meta' }, bkMeta(b)),
      b.clash ? h('p', { class: 'warn', role: 'note' }, h('b', null, 'Clash: '), b.clash) : null,
      contactEl(b),
      b.message ? h('div', { class: 'note' }, '“' + b.message + '”') : null,
      h('div', { class: 'meta' }, 'Received ' + whenText(b.received)),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => bookingAction(b, 'approve') }, 'Approve'),
        h('button', { class: 'btn small line', onclick: () => bookingAction(b, 'decline') }, 'Decline'),
        h('button', { class: 'btn small line', onclick: () => viewDate(b.date) }, 'View date')))));
}

function upcomingCard() {
  return h('div', { class: 'card' },
    h('h3', null, 'Function room bookings'),
    h('p', { class: 'sub' }, 'Approved online bookings coming up. Each one has a bar cover reminder in the diary.'),
    bkCardBody(S.upcoming, 'No online bookings coming up.', b => h('div', { class: 'req' },
      h('div', { class: 'ttl' }, b.type, h('span', { class: 'ref' }, b.id)),
      h('div', { class: 'meta' }, bkMeta(b)),
      contactEl(b),
      b.by ? h('div', { class: 'meta' }, 'Approved by ' + b.by) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small line', onclick: () => viewDate(b.date) }, 'View date'),
        h('button', { class: 'btn small line', onclick: () => bookingAction(b, 'cancel') }, 'Cancel booking')))));
}

function outboxCard() {
  return h('div', { class: 'card' }, h('h3', null, 'Demo outbox'),
    h('p', { class: 'sub' }, 'Demo only. The real diary sends these emails from the club account. Nothing is sent in the demo.'),
    h('div', { class: 'reqs' }, S.outbox.map(m => h('details', { class: 'req' },
      h('summary', null, h('b', null, m.subject), h('div', { class: 'meta' }, 'To ' + m.to + ' · ' + whenText(m.when))),
      h('div', { class: 'note mailbody' }, m.body)))));
}

function bookingAction(b, kind) {
  const C = {
    approve: { title: 'Approve this booking?', go: 'Approve booking', cls: 'btn', busy: 'Approving…', done: 'Approved',
      lines: ['Adds "Private party" to the diary for that session. The public see it as booked.', 'Adds a bar cover reminder to the diary.', 'Emails ' + b.name + ' to confirm the booking.'] },
    decline: { title: 'Decline this request?', go: 'Decline request', cls: 'btn danger', busy: 'Declining…', done: 'Declined',
      label: 'Reason (optional). It goes in the email to the customer.', lines: ['Emails ' + b.name + ' to say the club cannot take the booking.'] },
    cancel: { title: 'Cancel this booking?', go: 'Cancel booking', cls: 'btn danger', busy: 'Cancelling…', done: 'Cancelled', required: true,
      label: 'Reason. It goes in the email to the customer.', lines: ['Removes the booking and its bar cover reminder from the diary.', 'Emails ' + b.name + ' with your reason.'] }
  }[kind];
  const reason = C.label ? h('textarea', { id: 'bkReason', maxlength: '500', placeholder: kind === 'cancel' ? 'e.g. The room is needed for essential repairs.' : '' }) : null;
  const err = h('p', { class: 'err', role: 'alert', hidden: true });
  const go = h('button', { class: C.cls, type: 'button' }, C.go);
  const back = h('button', { class: 'btn line', type: 'button', onclick: closeModal }, 'Back');
  go.addEventListener('click', async () => {
    const why = reason ? reason.value.trim() : '';
    if (C.required && why.length < 3) return setErr(err, 'Add a reason. It goes in the email to the customer.');
    setErr(err, ''); go.disabled = true; back.disabled = true; go.textContent = C.busy;
    try {
      const r = await api(kind, { id: b.id, reason: why });
      closeModal();
      toast(C.done + '. ' + (r.emailed ? b.name + ' has been emailed.' : "The email couldn't be sent, so please tell " + b.name + ' yourself.'));
      loadBookings(); afterChange();
    } catch (e) { if (e.auth) return; setErr(err, e.message); go.disabled = false; back.disabled = false; go.textContent = C.go; }
  });
  modal(C.title,
    h('div', { class: 'summary' }, h('b', null, b.type + ' · ' + b.id), h('span', null, nice(b.date) + ', ' + (SESS_NAME[b.sess] || '')), h('span', null, b.guests + ' guests · ' + b.name)),
    b.clash && kind === 'approve' ? h('p', { class: 'warn' }, h('b', null, 'Clash: '), b.clash) : null,
    h('ul', { class: 'does' }, C.lines.map(l => h('li', null, l))),
    reason ? h('div', { class: 'f' }, h('label', { for: 'bkReason' }, C.label), reason) : null,
    err, h('div', { class: 'row' }, go, back));
}

function whenText(w) { // "2026-11-07 16:42"
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(w || ''));
  if (!m) return String(w || '');
  const day = m[1] === TODAY ? 'today' : m[1] === addDays(TODAY, -1) ? 'yesterday' : short(m[1]);
  return day + ' ' + m[2];
}

async function copyFeed() {
  try { await navigator.clipboard.writeText(S.feed); toast('Link copied'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents(document.querySelector('.feed')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Link selected. Press and hold to copy'); }
}

/* ---------- modal + toast ---------- */
let lastFocus = null;
function modal(title, ...body) {
  lastFocus = document.activeElement;
  const close = h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: closeModal, type: 'button' },
    h('span', { 'aria-hidden': 'true' }, '×'));
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mTitle' },
    h('header', null, h('h3', { id: 'mTitle' }, title), close), h('div', { class: 'body' }, body));
  const scrim = h('div', { class: 'scrim', onclick: e => { if (e.target === scrim) closeModal(); } }, box);
  fill($('modalRoot'), scrim);
  const f = box.querySelector('input,select,textarea,button.btn'); if (f) f.focus();
}
function closeModal() { fill($('modalRoot')); if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } lastFocus = null; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

let toastTimer;
function toast(msg) { fill($('toastRoot'), h('div', { class: 'toast', role: 'status' }, msg)); clearTimeout(toastTimer); toastTimer = setTimeout(() => fill($('toastRoot')), 3000); }

/* ---------- add / edit / delete ---------- */
function sessionOf(e) { // which part of the day an item uses: aft, eve or day
  if (!e.start) return 'day';
  const s = +e.start.slice(0, 2); let eh = +e.end.slice(0, 2);
  if (eh === 0) eh = 24;
  if (e.end <= e.start) eh += 24;
  if (eh > 48) eh -= 24;
  const aft = s < 17, eve = eh > 18 || s >= 17;
  return aft && eve ? 'day' : aft ? 'aft' : 'eve';
}
const usesRoom = e => e.cat === 'room' || e.room;
function clashWith(data, editingId) {
  // Checked against what is on screen. The server-side check arrives with online booking (stage 3).
  const mine = sessionOf(data);
  const bad = S.events.find(e => e.id !== editingId && e.date === data.date && usesRoom(e) && (() => {
    const s = sessionOf(e); return s === 'day' || mine === 'day' || s === mine;
  })());
  return bad || null;
}

function openEditor(ev) {
  const isNew = !ev;
  const e = ev || { date: S.view === 'month' ? S.sel : TODAY, start: '19:00', end: '21:00', title: '', cat: 'club', pub: false, notes: '', room: false };
  const isBooking = !!e.bk; // an approved online booking: change it with Cancel in the bookings card
  const readOnly = isFixture(e) || isBooking;
  const dis = readOnly;

  const title = h('input', { id: 'eTitle', maxlength: '100', value: e.title, placeholder: 'e.g. Quiz night', disabled: dis });
  const cat = h('select', { id: 'eCat', disabled: dis }, Object.keys(CATS).map(k => h('option', { value: k, selected: k === e.cat }, CATS[k].label)));
  const date = h('input', { id: 'eDate', type: 'date', value: e.date, disabled: dis });
  const start = h('input', { id: 'eStart', type: 'time', value: e.start, disabled: dis });
  const end = h('input', { id: 'eEnd', type: 'time', value: e.end, disabled: dis });
  const notes = h('textarea', { id: 'eNotes', maxlength: '1000', disabled: dis }, e.notes || '');
  const room = h('input', { type: 'checkbox', id: 'eRoom', checked: !!(e.room || e.cat === 'room'), disabled: dis });
  const pub = h('input', { type: 'checkbox', id: 'ePub', checked: !!e.pub, disabled: dis });
  const err = h('p', { class: 'err full', role: 'alert', hidden: true });
  const lockRoom = () => { // room hire always uses the room and always shows publicly, as "Private party"
    const r = cat.value === 'room';
    if (r) { room.checked = true; pub.checked = true; }
    if (!readOnly) { room.disabled = r; pub.disabled = r; }
  };
  cat.addEventListener('change', lockRoom); lockRoom();

  const submit = h('button', { class: 'btn', type: 'submit' }, isNew ? 'Add to diary' : 'Save changes');
  const buttons = [submit];
  if (!isNew && !readOnly) {
    let armed = false;
    const del = h('button', { class: 'btn line', type: 'button' }, 'Delete');
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'Tap again to delete'; del.className = 'btn danger'; return; }
      del.disabled = true; submit.disabled = true; del.textContent = 'Deleting…';
      try { await api('delete', { id: ev.id }); closeModal(); toast('Deleted'); afterChange(); }
      catch (x) { if (x.auth) return; setErr(err, x.message); del.disabled = false; submit.disabled = false; armed = false; del.textContent = 'Delete'; del.className = 'btn line'; }
    });
    buttons.push(del);
  }

  const form = h('form', { class: 'fgrid', novalidate: true },
    h('div', { class: 'f full' }, h('label', { for: 'eTitle' }, "What's happening"), title),
    h('div', { class: 'f' }, h('label', { for: 'eCat' }, 'Type'), cat),
    h('div', { class: 'f' }, h('label', { for: 'eDate' }, 'Date'), date),
    h('div', { class: 'f' }, h('label', { for: 'eStart' }, 'Start'), start),
    h('div', { class: 'f' }, h('label', { for: 'eEnd' }, 'Finish'), end),
    h('div', { class: 'f full' }, h('label', { for: 'eNotes' }, 'Notes for the committee'), notes),
    h('label', { class: 'check full' }, room, 'Uses the function room (stops the public booking it for those times)'),
    h('label', { class: 'check full' }, pub, 'Show on the public website (room hire always shows as "Private party" with no names)'),
    err,
    h('div', { class: 'row full' }, readOnly ? h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Close') : buttons));

  form.addEventListener('submit', async x => {
    x.preventDefault();
    if (readOnly) return;
    const data = { title: title.value.trim(), cat: cat.value, date: date.value, start: start.value, end: end.value,
      notes: notes.value.trim(), pub: pub.checked, room: room.checked };
    if (ev) data.id = ev.id;
    const bad = !data.title ? 'Give it a name so people know what it is.'
      : !data.date ? 'Choose a date.'
      : (!data.start || !data.end) ? 'Add a start and finish time.' : '';
    if (bad) return setErr(err, bad);
    if (data.room) {
      const c = clashWith(data, ev && ev.id);
      if (c) return setErr(err, 'The function room is already in use that ' + SESS_LABEL[sessionOf(c)] + ' on ' + nice(data.date) + ' (' + c.title + '). Check the day first.');
    }
    setErr(err, ''); submit.disabled = true; submit.textContent = 'Saving…';
    try {
      const r = await api('save', { event: data });
      closeModal(); toast(isNew ? 'Added to the diary' : 'Saved');
      goToDate(r.event ? r.event.date : data.date);
    } catch (e2) { if (e2.auth) return; setErr(err, e2.message); submit.disabled = false; submit.textContent = isNew ? 'Add to diary' : 'Save changes'; }
  });

  modal(isNew ? 'Add to the diary' : (isBooking ? 'Online booking' : readOnly ? 'Fixture' : 'Edit diary item'),
    isBooking ? h('p', { class: 'hint' }, 'This is an approved online booking. The contact details are in the Function room bookings card. To cancel it, use Cancel booking there so the customer is emailed.')
      : readOnly ? h('p', { class: 'hint' }, 'This fixture comes from Play-Cricket. Change it there and the diary updates the next morning.') : null,
    form);
}

function goToDate(d) {
  S.sel = d;
  if (S.view === 'month') { const x = parse(d); S.y = x.getFullYear(); S.m = x.getMonth(); }
  afterChange();
}
function afterChange() { load(); loadLog(); }

/* ---------- top controls ---------- */
function setMonth(y, m) { S.y = y; S.m = m; S.sel = (y === now.getFullYear() && m === now.getMonth()) ? TODAY : iso(y, m, 1); load(); render(); }
$('prev').addEventListener('click', () => setMonth(S.m === 0 ? S.y - 1 : S.y, (S.m + 11) % 12));
$('next').addEventListener('click', () => setMonth(S.m === 11 ? S.y + 1 : S.y, (S.m + 1) % 12));
$('todayBtn').addEventListener('click', () => setMonth(now.getFullYear(), now.getMonth()));
$('vMonth').addEventListener('click', () => { S.view = 'month'; load(); render(); });
$('vList').addEventListener('click', () => { S.view = 'list'; S.events = []; load(); render(); });
$('addBtn').addEventListener('click', () => openEditor(null));

/* ---------- demo mode: shared sample data in demo.js ---------- */
async function demoApi(action, p) {
  if (DEMO_OFFLINE) { await new Promise(r => setTimeout(r, 120)); throw new ApiError("Can't reach the diary. Check your signal or wifi and try again. Nothing was changed."); }
  try { return await window.DiaryDemo.api(action, p, S.session ? S.session.name : 'Demo'); }
  catch (e) { throw new ApiError(e.message); }
}

/* ---------- start ---------- */
function boot() {
  if (DEMO) {
    $('demoBar').hidden = false;
    $('demoReset').addEventListener('click', () => { window.DiaryDemo.reset(); location.reload(); });
  }
  if (!DEMO && !HAS_BACKEND) return showOnly('noBackend');
  if (!DEMO) {
    try {
      const s = JSON.parse(store('ecc-diary-session') || 'null');
      if (s && s.token && s.expires > Date.now()) { S.session = s; return startApp(); }
    } catch (e) {}
    store('ecc-diary-session', null);
  }
  showSignin();
}
boot();
})();

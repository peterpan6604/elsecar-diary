/* Elsecar Club Diary: public page (what's on, and function room requests).
   Plain JavaScript, no libraries. Everything from the server or typed by a visitor is put on the page
   as text (textContent / text nodes, never innerHTML), so nothing can run as code.
   The rules here only give quick feedback. The server checks every request again. */
(function () {
'use strict';

const CFG = window.DIARY_CONFIG || {};
const R = window.DiaryRules;
const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const HAS_BACKEND = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(CFG.BACKEND_URL || '');
/* Demo mode only: load the pretend server. Normal visits never download it. */
const demoReady = DEMO ? new Promise((ok, no) => {
  const s = document.createElement('script');
  s.src = 'demo.js?v=2'; s.onload = ok; s.onerror = () => no(new Error('The demo could not load. Refresh to try again.'));
  document.head.append(s);
}) : null;
const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

const CATS = {
  room:    { label: 'Function room', c: 'var(--c-room)' },
  club:    { label: 'Club events',   c: 'var(--c-club)' },
  cricket: { label: 'Cricket',       c: 'var(--c-cricket)' }
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = d => iso(d.getFullYear(), d.getMonth(), d.getDate());
const nice = s => { const d = parse(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const short = s => { const d = parse(s); return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); };
const time12 = t => { if (!t) return ''; if (t === '00:00') return 'midnight'; let [hh, mm] = t.split(':').map(Number); const ap = hh >= 12 && hh < 24 ? 'pm' : 'am'; hh = hh % 12 || 12; return hh + (mm ? ':' + pad(mm) : '') + ap; };

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v; // set through the style object, which the page's security policy allows
    else if (k === 'c') n.style.setProperty('--c', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
function fill(node, ...kids) { node.replaceChildren(...kids.flat(Infinity).filter(Boolean)); }
function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) {} return null; }
function deviceId() {
  let id = store('ecc-public-device');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)); store('ecc-public-device', id); }
  return id;
}
let toastTimer;
function toast(msg) { fill($('toastRoot'), h('div', { class: 'toast', role: 'status' }, msg)); clearTimeout(toastTimer); toastTimer = setTimeout(() => fill($('toastRoot')), 3500); }

/* ---------- state ---------- */
const now = new Date();
const S = {
  today: isoOf(now),         // replaced by the club's date from the server
  y: now.getFullYear(), m: now.getMonth(), sel: isoOf(now),
  off: new Set(),
  events: [],                // this month's public items
  taken: {},                 // date -> sessions already booked, for every date loaded so far
  known: new Set(),          // dates we have room information for
  coming: [],
  rules: { privacyContact: '', capacity: R.MAX_GUESTS, termsUrl: '', minNotice: R.MIN_NOTICE, maxMonths: R.MAX_MONTHS, shortNoticeType: R.SHORT_NOTICE_TYPE, types: R.TYPES },
  loadErr: '', loading: false,
  form: null,                // open request form: { date, sess, type, ... }
  sent: null                 // { ref, emailed } after a request is sent
};
const earliest = () => R.addDays(S.today, S.rules.minNotice);
const earliestWake = () => R.addDays(S.today, 1);
const latest = () => R.addMonths(S.today, S.rules.maxMonths);
const takenOn = d => S.taken[d] || [];
const freeSessions = d => ['aft', 'eve'].filter(s => R.canAsk(takenOn(d), s));

/* ---------- server ---------- */
const cache = {};
async function getPublic(from, to) {
  const key = from + ':' + to;
  if (cache[key] && Date.now() - cache[key].t < 60000) return cache[key].data;
  let data;
  if (DEMO) { await demoReady; data = await window.DiaryDemo.api('public', { from, to }); }
  else {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(CFG.BACKEND_URL + '?action=public&from=' + from + '&to=' + to, { signal: ctrl.signal });
      data = await res.json();
    } catch (e) { throw new Error("Can't load the diary just now. Check your connection and try again."); }
    finally { clearTimeout(timer); }
    if (!data || data.ok !== true) throw new Error((data && data.error) || "Can't load the diary just now. Try again in a minute.");
  }
  // An older server has no room information. Never guess that dates are free.
  if (!data.roomTaken || typeof data.roomTaken !== 'object') throw new Error("Function room dates aren't available just now. Please try again later.");
  // Remember room information for every date in the range, booked or not
  for (let d = from; d <= to; d = R.addDays(d, 1)) { S.known.add(d); delete S.taken[d]; }
  Object.keys(data.roomTaken || {}).forEach(d => { S.taken[d] = data.roomTaken[d]; });
  if (data.rules) {
    const r = data.rules;
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.today || '')) S.today = r.today;
    S.rules = { capacity: +r.capacity || R.MAX_GUESTS, termsUrl: /^https:\/\//.test(r.termsUrl || '') ? r.termsUrl : '',
      minNotice: +r.minNotice || R.MIN_NOTICE, maxMonths: +r.maxMonths || R.MAX_MONTHS,
      shortNoticeType: r.shortNoticeType || R.SHORT_NOTICE_TYPE, types: Array.isArray(r.types) && r.types.length ? r.types.map(String) : R.TYPES,
      privacyContact: String(r.privacyContact || '').slice(0, 120) };
  }
  cache[key] = { t: Date.now(), data };
  return data;
}

async function sendRequest(body) {
  if (DEMO) { await demoReady; return window.DiaryDemo.api('request', body); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let data;
  try {
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    const res = await fetch(CFG.BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: 'request' }, body)), signal: ctrl.signal });
    data = await res.json();
  } catch (e) { throw new Error("Your request didn't reach us. Check your connection and try again."); }
  finally { clearTimeout(timer); }
  if (!data || data.ok !== true) throw new Error((data && data.error) || 'Something went wrong. Try again in a minute.');
  return data;
}

function gridRange() {
  const lead = (new Date(S.y, S.m, 1).getDay() + 6) % 7;
  const cells = Math.ceil((lead + new Date(S.y, S.m + 1, 0).getDate()) / 7) * 7;
  const start = new Date(S.y, S.m, 1 - lead);
  return [isoOf(start), isoOf(new Date(S.y, S.m, 1 - lead + cells - 1)), cells];
}

let reqId = 0;
async function loadMonth() {
  const my = ++reqId;
  const [from, to] = gridRange();
  S.loading = true; $('mainCol').classList.add('loading');
  try {
    const r = await getPublic(from, to);
    if (my !== reqId) return;
    S.events = r.events || []; S.loadErr = '';
  } catch (e) { if (my !== reqId) return; S.loadErr = e.message; }
  S.loading = false; $('mainCol').classList.remove('loading');
  render();
}
async function loadComing() {
  try { const r = await getPublic(S.today, R.addDays(S.today, 89)); S.coming = r.events || []; renderSide(); } catch (e) { /* the list is an extra */ }
}
async function ensureDate(d) { // room information for a date picked on the form
  if (!d || S.known.has(d)) return;
  try { await getPublic(d, d); } catch (e) { /* the server checks again when the request is sent */ }
}

/* ---------- display ---------- */
const byTime = (a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')) || a.title.localeCompare(b.title);
const shown = e => CATS[e.cat] && !S.off.has(e.cat);
const timeText = e => e.allDay || !e.start ? 'All day' : time12(e.start) + ' to ' + time12(e.end);

function render() {
  $('monthLabel').textContent = MONTHS[S.m] + ' ' + S.y;
  setBanner();
  renderLegend(); renderGrid(); renderSide();
}
function setBanner() {
  const b = $('loadErr');
  b.hidden = !S.loadErr;
  if (S.loadErr) fill(b, S.loadErr + ' ', h('button', { class: 'btn small line', onclick: loadMonth }, 'Try again'));
}
function renderLegend() {
  fill($('legend'), Object.keys(CATS).map(k =>
    h('button', { class: 'chip', c: CATS[k].c, 'aria-pressed': String(!S.off.has(k)), onclick: () => { S.off.has(k) ? S.off.delete(k) : S.off.add(k); render(); } },
      h('i'), CATS[k].label)));
}

function roomChip(d) {
  if (d < earliest() || d > latest() || !S.known.has(d)) return null;
  const f = freeSessions(d);
  if (f.length === 2) return h('span', { class: 'room free' }, 'Free');
  if (f.length === 1) return h('span', { class: 'room part', title: (f[0] === 'aft' ? 'Afternoon' : 'Evening') + ' free' },
    h('span', { class: 'long' }, (f[0] === 'aft' ? 'Afternoon' : 'Evening') + ' free'), h('span', { class: 'short' }, f[0] === 'aft' ? 'Aft free' : 'Eve free'));
  return h('span', { class: 'room booked' }, 'Booked');
}

function renderGrid() {
  const [start, , cells] = gridRange();
  const out = [];
  for (let i = 0; i < cells; i++) {
    const d = R.addDays(start, i);
    const dt = parse(d);
    const evs = S.events.filter(e => e.date === d && shown(e)).sort(byTime);
    const bookable = d >= earliest() && d <= latest() && S.known.has(d) && freeSessions(d).length > 0;
    const chip = roomChip(d);
    out.push(h('button', {
      class: 'day' + (dt.getMonth() !== S.m ? ' out' : '') + (d === S.today ? ' today' : '') + (d === S.sel ? ' sel' : '') + (bookable ? ' roomfree' : '') + (d < S.today ? ' past' : ''),
      'aria-label': nice(d) + ', ' + evs.length + (evs.length === 1 ? ' event' : ' events') + (chip ? ', function room: ' + (chip.title || chip.textContent).toLowerCase() : ''),
      'aria-pressed': String(d === S.sel),
      onclick: () => selectDate(d)
    },
      h('span', { class: 'num' }, h('b', null, dt.getDate()), chip),
      h('span', { class: 'evs' },
        evs.slice(0, 3).map(e => h('span', { class: 'ev', c: CATS[e.cat].c }, h('span', { class: 't' }, e.allDay ? '' : time12(e.start)), e.title)),
        evs.length > 3 ? h('span', { class: 'more' }, '+' + (evs.length - 3) + ' more') : null)));
  }
  fill($('grid'), out);
}

function selectDate(d) {
  S.sel = d;
  const x = parse(d);
  if (x.getMonth() !== S.m || x.getFullYear() !== S.y) { S.y = x.getFullYear(); S.m = x.getMonth(); loadMonth(); }
  render();
  // On a narrow screen the day details sit under the calendar
  if (window.matchMedia('(max-width:900px)').matches) { const c = $('dayCard'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function renderSide() {
  const cards = [];
  if (S.sent) cards.push(sentCard());
  else if (S.form) cards.push(formCard());
  cards.push(dayCard());
  if (!S.form && !S.sent) cards.push(ctaCard());
  cards.push(comingCard());
  fill($('side'), cards);
}

function dayCard() {
  const d = S.sel;
  const evs = S.events.filter(e => e.date === d && shown(e)).sort(byTime);
  const slots = [];
  let note = null;
  if (d < S.today) note = 'This date has passed.';
  else if (d > latest()) note = 'We take function room requests up to ' + S.rules.maxMonths + ' months ahead.';
  else if (!S.known.has(d)) note = S.loading ? 'Loading…' : '';
  else {
    const wakeOnly = d < earliest();
    if (wakeOnly) note = d === S.today
      ? 'For anything today, please ring the club.'
      : 'We need ' + S.rules.minNotice + " days' notice for the function room. For a funeral wake you can still send a request.";
    if (d !== S.today) {
      ['aft', 'eve'].forEach(s => {
        const free = R.canAsk(takenOn(d), s);
        slots.push(h('div', { class: 'slot' },
          h('div', null, h('b', null, R.SESSIONS[s].label), h('span', null, R.SESSIONS[s].time)),
          free ? h('button', { class: 'btn small', onclick: () => openForm(d, s, wakeOnly ? S.rules.shortNoticeType : '') }, wakeOnly ? 'Request a wake' : 'Request')
            : h('span', { class: 'tag' }, 'Booked')));
      });
    }
  }
  return h('div', { class: 'card', id: 'dayCard' },
    h('h3', null, nice(d)),
    note ? h('p', { class: 'sub' }, note) : null,
    slots.length ? h('div', null, h('p', { class: 'label' }, 'Function room'), h('div', { class: 'slots' }, slots)) : null,
    evs.length ? h('ul', { class: 'list', style: 'margin-top:14px' }, evs.map(e => h('li', { class: 'item' },
      h('span', { class: 'bar', c: CATS[e.cat].c }),
      h('div', null, h('div', { class: 'ttl' }, e.title), h('div', { class: 'meta' }, timeText(e))))))
      : h('p', { class: 'empty', style: 'margin-top:12px' }, 'No public events on this day.'));
}

function rulesList() {
  return h('ul', { class: 'rules' },
    h('li', null, 'This is a request, not a booking. The committee will confirm by email or phone.'),
    h('li', null, 'Afternoon is 12pm to 5pm. Evening is 6pm to midnight. Whole day is both.'),
    h('li', null, 'Please ask at least ' + S.rules.minNotice + " days ahead. Funeral wakes can be shorter notice."),
    h('li', null, 'We take requests up to ' + S.rules.maxMonths + ' months ahead.'),
    h('li', null, 'The room holds up to ' + S.rules.capacity + ' people, including staff and entertainers.'),
    S.rules.termsUrl ? h('li', null, 'Read the ', h('a', { href: S.rules.termsUrl, target: '_blank', rel: 'noopener' }, 'hire terms'), '.') : null);
}

/** UK GDPR: who holds the details, why, who sees them, how long, and who to ask. */
function privacyNote() {
  const c = S.rules.privacyContact;
  const contact = !c ? 'contact the club'
    : R.isEmail(c) ? h('a', { href: 'mailto:' + encodeURIComponent(c).replace(/%40/g, '@') }, c) : c;
  return h('p', { class: 'privacy' },
    h('b', null, 'Your details. '),
    'Elsecar Sports & Social Club uses your name, phone number and email only to deal with this booking request. Only the committee sees them. ',
    "We delete your contact details 6 months after the event, or 30 days after we reply if we can't take the booking. ",
    'Questions about your data: ', contact, '.');
}

function ctaCard() {
  return h('div', { class: 'card cta' },
    h('h3', null, 'Hire the function room'),
    h('p', { class: 'sub' }, 'For parties, christenings, wakes, meetings and more. Pick a free date and send us a request.'),
    rulesList(),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn gold', onclick: () => {
      const d = S.sel >= earliest() && S.sel <= latest() && freeSessions(S.sel).length ? S.sel : '';
      openForm(d, d ? freeSessions(d)[0] : '', '');
    } }, 'Send a request')));
}

function comingCard() {
  const list = S.coming.filter(e => e.date >= S.today && e.cat !== 'room' && shown(e)).sort(byTime).slice(0, 6);
  return h('div', { class: 'card' }, h('h3', null, 'Coming up'),
    list.length ? h('ul', { class: 'list' }, list.map(e => h('li', { class: 'item' },
      h('span', { class: 'bar', c: CATS[e.cat].c }),
      h('button', { class: 'linkish', onclick: () => selectDate(e.date) },
        h('div', { class: 'ttl' }, e.title), h('div', { class: 'meta' }, short(e.date) + ' · ' + timeText(e))))))
      : h('p', { class: 'empty' }, 'Nothing listed yet.'));
}

/* ---------- request form ---------- */
let openedAt = 0;
function openForm(date, sess, type) {
  S.sent = null;
  S.form = Object.assign({ name: '', phone: '', email: '', guests: '', message: '' }, S.form || {}, { date: date || '', sess: sess || '', type: type || (S.form && S.form.type) || '' });
  openedAt = Date.now();
  ensureDate(S.form.date).then(renderSide);
  renderSide();
  const f = $('rName'); if (f) f.focus({ preventScroll: true });
  const card = $('formCard'); if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const FIELD_FOR = [[/name/i, 'rName'], [/phone/i, 'rPhone'], [/email/i, 'rEmail'], [/session|booked that/i, 'rSess-aft'], [/type of event/i, 'rType'],
  [/guests|holds up to/i, 'rGuests'], [/date|notice|wake|months ahead/i, 'rDate']];

function formCard() {
  const F = S.form;
  const err = h('p', { class: 'err', id: 'rErr', role: 'alert', hidden: true });
  const field = (id, label, input, hint) => h('div', { class: 'f' + (input.tagName === 'TEXTAREA' ? ' full' : '') }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const keep = (k) => e => { F[k] = e.target.value; };

  const name = h('input', { id: 'rName', maxlength: '80', autocomplete: 'name', value: F.name, oninput: keep('name') });
  const phone = h('input', { id: 'rPhone', type: 'tel', maxlength: '25', autocomplete: 'tel', value: F.phone, oninput: keep('phone') });
  const email = h('input', { id: 'rEmail', type: 'email', maxlength: '120', autocomplete: 'email', value: F.email, oninput: keep('email') });
  const minDate = F.type === S.rules.shortNoticeType ? earliestWake() : earliest();
  const date = h('input', { id: 'rDate', type: 'date', min: minDate, max: latest(), value: F.date, onchange: e => { F.date = e.target.value; ensureDate(F.date).then(renderSide); renderSide(); } });
  const type = h('select', { id: 'rType', onchange: e => { F.type = e.target.value; renderSide(); } },
    h('option', { value: '', selected: !F.type }, 'Choose…'),
    S.rules.types.map(t => h('option', { value: t, selected: t === F.type }, t)));
  const guests = h('input', { id: 'rGuests', type: 'number', inputmode: 'numeric', min: '1', max: String(S.rules.capacity), value: F.guests, placeholder: 'Up to ' + S.rules.capacity, oninput: keep('guests') });
  const message = h('textarea', { id: 'rMsg', maxlength: '1000', placeholder: 'Catering, music, timings, anything we should know', oninput: keep('message') }, F.message);
  // Spam trap: hidden from people, but simple bots fill it in
  const trap = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'rWebsite' }, 'Leave this empty'), h('input', { id: 'rWebsite', tabindex: '-1', autocomplete: 'off' }));

  const known = !F.date || S.known.has(F.date);
  const sessOpts = ['aft', 'eve', 'day'].map(s => {
    const ok = !F.date || !known || R.canAsk(takenOn(F.date), s);
    if (!ok && F.sess === s) F.sess = '';
    return h('label', { class: 'sopt' + (ok ? '' : ' off') },
      h('input', { type: 'radio', name: 'rSess', id: 'rSess-' + s, value: s, disabled: !ok, checked: F.sess === s, onchange: () => { F.sess = s; } }),
      h('span', null, h('b', null, R.SESSIONS[s].label), h('span', null, ok ? R.SESSIONS[s].time : 'Booked')));
  });

  const submit = h('button', { class: 'btn gold', type: 'submit' }, 'Send request');
  const form = h('form', { class: 'fgrid', novalidate: true },
    field('rName', 'Your name', name),
    field('rPhone', 'Phone', phone),
    h('div', { class: 'f full' }, h('label', { for: 'rEmail' }, 'Email'), email),
    field('rDate', 'Date', date),
    field('rType', 'Type of event', type),
    h('fieldset', { class: 'f full sessfield' }, h('legend', null, 'Session'), h('div', { class: 'sessopts' }, sessOpts)),
    field('rGuests', 'Guests (roughly)', guests),
    h('div', { class: 'f full' }, h('label', { for: 'rMsg' }, 'Message (optional)'), message),
    trap,
    h('div', { class: 'full' }, rulesList()),
    h('div', { class: 'full' }, privacyNote()),
    h('div', { class: 'full' }, err),
    h('div', { class: 'row full' }, submit, h('button', { class: 'btn line', type: 'button', onclick: () => { S.form = null; renderSide(); } }, 'Close')));

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const body = { name: name.value, phone: phone.value, email: email.value, date: date.value, sess: F.sess, type: type.value,
      guests: guests.value, message: message.value, website: $('rWebsite').value, elapsed: Date.now() - openedAt, deviceId: deviceId() };
    const show = (msg) => {
      err.textContent = msg; err.hidden = false;
      const hit = FIELD_FOR.find(([re]) => re.test(msg));
      if (hit && $(hit[1])) $(hit[1]).focus();
    };
    try { R.validate(body, S.today, S.rules.capacity); } catch (e) { return show(e.message); }
    if (S.known.has(body.date) && !R.canAsk(takenOn(body.date), body.sess)) return show('Sorry, the function room is already booked that ' + R.SESSIONS[body.sess].label.toLowerCase() + '. Please choose another date or session.');
    err.hidden = true; submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const r = await sendRequest(body);
      S.sent = { ref: r.ref || '', emailed: !!r.emailed, date: body.date, sess: body.sess };
      S.form = null;
      renderSide();
      const c = $('sentCard'); if (c) { c.scrollIntoView({ block: 'start', behavior: 'smooth' }); c.focus({ preventScroll: true }); }
    } catch (e) { submit.disabled = false; submit.textContent = 'Send request'; show(e.message); }
  });

  return h('div', { class: 'card', id: 'formCard' },
    h('h3', null, 'Ask to hire the function room'),
    h('p', { class: 'sub' }, 'Fill this in and the committee will get back to you. Nothing is booked until they confirm.'),
    form);
}

function sentCard() {
  const s = S.sent;
  return h('div', { class: 'card done', id: 'sentCard', tabindex: '-1' },
    h('div', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
    h('h3', null, 'Request sent'),
    h('p', { class: 'big' }, 'This is a request, not a confirmed booking. The committee will be in touch.'),
    s.ref ? h('p', { class: 'sub' }, nice(s.date) + ', ' + R.SESSIONS[s.sess].label.toLowerCase() + '. Your reference is ', h('b', null, s.ref), '.') : null,
    s.ref && s.emailed ? h('p', { class: 'sub' }, "We've emailed you a copy. If you can't see it, check your junk folder.") : null,
    h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: () => { S.sent = null; renderSide(); } }, 'Done')));
}

/* ---------- top controls ---------- */
function setMonth(y, m) { S.y = y; S.m = m; S.sel = (y === now.getFullYear() && m === now.getMonth()) ? S.today : iso(y, m, 1); loadMonth(); render(); }
$('prev').addEventListener('click', () => setMonth(S.m === 0 ? S.y - 1 : S.y, (S.m + 11) % 12));
$('next').addEventListener('click', () => setMonth(S.m === 11 ? S.y + 1 : S.y, (S.m + 1) % 12));
$('todayBtn').addEventListener('click', () => setMonth(now.getFullYear(), now.getMonth()));

/* ---------- start ---------- */
function boot() {
  if (DEMO) {
    $('demoBar').hidden = false;
    $('demoReset').addEventListener('click', () => demoReady.then(() => { window.DiaryDemo.reset(); location.reload(); }));
  }
  if (IN_FRAME) { $('fullLink').hidden = false; if (DEMO) $('fullLink').href = 'index.html?demo=1'; }
  if (!DEMO && !HAS_BACKEND) { $('noBackend').hidden = false; return; }
  $('app').hidden = false;
  render();
  loadMonth().then(loadComing);
}
boot();
})();

// Upsell desk demo. The page runs the same engine modules as the server (engine/*.js):
// PMS webhooks in, scheduled emails, offer page, booking, folio charges with retries.
import * as E from './engine/index.js';

const WEBHOOK_SECRET = 'demo-webhook-secret';
const T0 = Date.UTC(2026, 10, 22, 9, 0); // Sunday 22 Nov 2026, 09:00 in Lisbon
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM: allowed by the page CSP
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** replaceChildren without stray "null" text for optional parts. */
function fill(el, ...kids) { el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false)); return el; }

// ------------------------------------------------------------------ guest page strings
const PAGE = {
  en: { inbox: 'Inbox', sold: 'no longer available for your dates', page: 'Offer page', done: 'Booked', none: 'No emails for this guest yet. Move the clock forward to the next send time.', stay: (a, d) => `Your stay: ${a} to ${d}`, choose: 'Choose what you would like. Everything is added to your bill at checkout.', confirm: 'Book selected extras', total: 'Total', booked: 'Booked. See you soon!', bookedSub: 'These are added to your stay and will be on your bill at checkout.', notBooked: 'Not booked', ref: 'Reference', open: 'Open the offer page', unsub: 'You will not receive more offer emails.', nothing: 'Nothing left to offer for this stay.', until: 'until' },
  pt: { inbox: 'Caixa de entrada', sold: 'já não está disponível nas suas datas', page: 'Ofertas', done: 'Reservado', none: 'Ainda sem emails para este hóspede.', stay: (a, d) => `A sua estadia: ${a} a ${d}`, choose: 'Escolha o que deseja. Tudo é adicionado à sua conta no check-out.', confirm: 'Reservar os extras escolhidos', total: 'Total', booked: 'Reservado. Até breve!', bookedSub: 'Foram adicionados à sua estadia e aparecem na conta no check-out.', notBooked: 'Não reservado', ref: 'Referência', open: 'Abrir as ofertas', unsub: 'Não receberá mais emails de ofertas.', nothing: 'Já não há ofertas para esta estadia.', until: 'até às' },
  fr: { inbox: 'Boîte de réception', sold: 'n’est plus disponible à vos dates', page: 'Offres', done: 'Réservé', none: 'Pas encore d’email pour ce client.', stay: (a, d) => `Votre séjour : du ${a} au ${d}`, choose: 'Choisissez ce qui vous fait plaisir. Tout est ajouté à votre note au départ.', confirm: 'Réserver ces extras', total: 'Total', booked: 'C’est réservé. À bientôt !', bookedSub: 'Ces extras sont ajoutés à votre séjour et figureront sur votre note.', notBooked: 'Non réservé', ref: 'Référence', open: 'Voir les offres', unsub: 'Vous ne recevrez plus d’emails d’offres.', nothing: 'Plus d’offre disponible pour ce séjour.', until: 'jusqu’à' },
  de: { inbox: 'Posteingang', sold: 'für Ihre Daten nicht mehr verfügbar', page: 'Angebote', done: 'Gebucht', none: 'Noch keine E-Mails für diesen Gast.', stay: (a, d) => `Ihr Aufenthalt: ${a} bis ${d}`, choose: 'Wählen Sie aus. Alles erscheint beim Check-out auf Ihrer Rechnung.', confirm: 'Ausgewählte Extras buchen', total: 'Gesamt', booked: 'Gebucht. Bis bald!', bookedSub: 'Die Extras sind Ihrem Aufenthalt hinzugefügt und stehen beim Check-out auf der Rechnung.', notBooked: 'Nicht gebucht', ref: 'Referenz', open: 'Angebote öffnen', unsub: 'Sie erhalten keine Angebots-E-Mails mehr.', nothing: 'Für diesen Aufenthalt gibt es keine Angebote mehr.', until: 'bis' },
};
const KIND = { breakfast: 'Breakfast', parking: 'Parking', upgrade: 'Room upgrade', late: 'Late checkout' };

// ------------------------------------------------------------------ in-page systems around the desk
let t = T0;
const inbox = new Map();      // resId -> messages
const charges = [];           // what the PMS folio received
const crmEvents = [];
const pmsState = { down: false, failNext: 0, keys: new Map() };
const adapters = {
  email: { send: async (m) => { const list = inbox.get(m.resId) || []; list.push({ ...m, at: t, id: `MSG-${list.length + 1}` }); inbox.set(m.resId, list); return { id: `MSG-${list.length}` }; } },
  pms: {
    postCharge: async (c) => {
      if (pmsState.down) throw new Error('PMS unavailable (503)');
      if (pmsState.failNext > 0) { pmsState.failNext--; throw new Error('PMS error (500)'); }
      if (pmsState.keys.has(c.idemKey)) return pmsState.keys.get(c.idemKey);
      const out = { chargeId: `CHG-${charges.length + 1}` };
      charges.push({ ...c, ...out, at: t }); pmsState.keys.set(c.idemKey, out);
      return out;
    },
    amendRoomType: async () => { if (pmsState.down) throw new Error('PMS unavailable (503)'); return { ok: true }; },
  },
  crm: { send: async (e) => { if (!crmEvents.some((x) => x.idemKey === e.idemKey)) crmEvents.push({ ...e, at: t }); return { ok: true }; } },
};
let store, desk, reservations = [], featured = null;
let sel = null; // selected reservation id
const guest = { tab: 'inbox', mail: null, view: null, choice: {}, order: null, notice: null };
let opsTab = 'decisions';
const flags = { pmsDown: false, race: false };
let ruleMsg = null;

const tz = () => E.HOTEL.timeZone;
const localStr = (ms, withDay = true) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), weekday: withDay ? 'short' : undefined, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const dayStr = (date) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
const eur = (v) => E.money(v, 'EUR', 'en');
const roomName = (code, lang = 'en') => E.HOTEL.roomTypes.find((r) => r.code === code).name[lang];
const guestName = (r) => `${r.guest.first} ${r.guest.last}`;
const langOf = (r) => (PAGE[r.guest.language] ? r.guest.language : 'en');

async function pmsEvent(type, reservation, { ts = t, id, forged = false } = {}) {
  const raw = JSON.stringify({ id: id || `evt-${Math.random().toString(36).slice(2, 10)}`, type, timestamp: ts, reservation });
  const sig = forged ? 'sha256=' + '0'.repeat(64) : 'sha256=' + (await E.hmacHex(WEBHOOK_SECRET, raw));
  return desk.handlePmsEvent(raw, sig);
}

async function boot() {
  store = new E.MemoryStore();
  desk = new E.Desk({ store, secret: 'demo-link-secret', webhookSecret: WEBHOOK_SECRET, clock: () => t, adapters, baseUrl: 'https://offers.meridiana.example' });
  reservations = E.makeReservations({ start: '2026-11-22', days: 30 });
  for (const r of reservations) {
    store.put('state', r.id, { sent: ['confirmation'], bought: [], clicked: false, unsubscribed: false }); // booked earlier, confirmed then
    await pmsEvent('reservation.created', r, { ts: t - 3600000 });
  }
  store.logs.length = 0;
  desk.log(null, 'PMS', `${reservations.length} reservations loaded from the PMS for the next 30 days`);
  const n = (r) => E.daysBetween(r.arrival, r.departure);
  featured = reservations.find((r) => r.guest.language === 'pt' && r.ratePlan === 'RO' && r.notes && r.roomType === 'CLA' && n(r) >= 3 && r.arrival >= '2026-11-29')
    || reservations.find((r) => r.ratePlan === 'RO' && r.notes && n(r) >= 2 && r.arrival >= '2026-11-29')
    || reservations.find((r) => r.arrival >= '2026-11-29');
  select(featured.id);
}

function select(id) {
  sel = id;
  Object.assign(guest, { tab: 'inbox', mail: null, view: null, choice: {}, order: null, notice: null });
  renderAll();
  const btn = document.querySelector(`[data-res="${id}"]`), list = $('#arrivals');
  if (btn && list) list.scrollTop = Math.max(0, btn.offsetTop - list.clientHeight / 2 + btn.offsetHeight / 2);
}

// ------------------------------------------------------------------ left pane
function renderLeft() {
  fill($('#clock'), 
    h('div', null, h('b', { class: 'when' }, localStr(t)), h('small', null, 'Hotel time, Lisbon. Demo clock.')),
    h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', 'data-act': 'hour', onclick: () => advance(t + 3600000) }, '+1 hour'),
      ' ', h('button', { class: 'btn small primary', type: 'button', 'data-act': 'next-email', onclick: nextEmail }, 'Next email')));
  const list = reservations.concat(extraRes).filter((r) => r.arrival >= '2026-11-22' && r.arrival <= '2026-12-06').sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : a.id < b.id ? -1 : 1));
  fill($('#arrivals'), ...list.map((r0) => {
    const r = getRes(r0.id);
    const st = desk.state(r.id);
    return h('li', null, h('button', { type: 'button', 'data-res': r.id, 'aria-current': String(r.id === sel), onclick: () => select(r.id) },
      h('span', null, guestName(r)), h('span', { class: 'tag' }, r.status === 'canceled' ? 'canceled' : r.guest.language.toUpperCase()),
      h('small', null, `${dayStr(r.arrival)}, ${E.daysBetween(r.arrival, r.departure)} n, ${r.roomType}, ${r.ratePlan === 'BB' ? 'B&B' : 'room only'}`),
      h('small', { class: 'st' }, st.bought.length ? `${st.bought.length} extra${st.bought.length > 1 ? 's' : ''}` : (inbox.get(r.id) || []).length ? `${inbox.get(r.id).length} email${inbox.get(r.id).length > 1 ? 's' : ''}` : '')));
  }));
  $('#arrivals-count').textContent = `${list.length} arriving by 6 Dec`;
}
const extraRes = [];
/** Reservation as the desk stores it, filled in from the PMS copy (a cancellation that
 * arrived first is stored as a bare tombstone). */
function getRes(id) {
  const base = reservations.find((r) => r.id === id) || extraRes.find((r) => r.id === id) || {};
  return { ...base, ...(store.get('res', id) || {}) };
}

// ------------------------------------------------------------------ guest pane
async function renderGuest() {
  const res = getRes(sel);
  const L = PAGE[langOf(res)];
  const mails = (inbox.get(sel) || []).slice().reverse();
  const tabs = $('#guest-tabs');
  const tab = (id, label) => h('button', { type: 'button', 'aria-current': guest.tab === id ? 'page' : null, 'data-gtab': id, onclick: () => { guest.tab = id; if (id === 'page') openOffer(); else renderGuest(); } }, label);
  fill(tabs, tab('inbox', `${L.inbox} (${mails.length})`), tab('page', L.page), tab('done', L.done));
  $('#guest-who').textContent = `${guestName(res)}, ${res.guest.email}`;
  const v = $('#guest-view');
  v.setAttribute('lang', langOf(res));
  if (guest.tab === 'inbox' && !guest.mail) {
    if (!mails.length) return fill(v, h('p', { class: 'empty' }, L.none));
    return fill(v, h('ul', { class: 'inbox' }, ...mails.map((m) => h('li', null, h('button', { type: 'button', 'data-mail': m.id, onclick: () => { guest.mail = m.id; renderGuest(); } },
      h('b', null, m.subject), h('small', null, `${localStr(m.at)} · ${m.promotional ? 'offer email' : 'transactional'}`))))));
  }
  if (guest.tab === 'inbox' && guest.mail) {
    const m = mails.find((x) => x.id === guest.mail);
    return fill(v, 
      h('button', { class: 'btn small', type: 'button', onclick: () => { guest.mail = null; renderGuest(); } }, '← ' + L.inbox),
      h('div', { class: 'mail-head' }, h('div', null, 'From: ', h('b', null, m.headers.From)), h('div', null, 'Subject: ', h('b', null, m.subject)),
        h('div', null, 'Sent: ', localStr(m.at)), m.headers['List-Unsubscribe'] ? h('div', null, h('code', null, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click')) : h('div', null, h('code', null, 'transactional, no unsubscribe header'))),
      h('p', null, E.STRINGS[m.lang].hi(res.guest.first)), h('p', null, m.intro),
      m.lines.length ? h('ul', { class: 'lines' }, ...m.lines.map((l) => h('li', null, h('b', null, l.title), ' ', l.price))) : null,
      m.promotional ? h('button', { class: 'cta', type: 'button', 'data-act': 'open-offer', onclick: () => { guest.tab = 'page'; openOffer(m.links.offerToken); } }, E.STRINGS[m.lang].cta) : null,
      h('p', { class: 'fine' }, E.STRINGS[m.lang].footer(E.HOTEL.name, E.HOTEL.city), ' ',
        m.promotional ? h('button', { class: 'btn small', type: 'button', 'data-act': 'unsub', onclick: () => unsubscribe(m.links.unsubToken) }, E.STRINGS[m.lang].unsub) : null),
      guest.notice ? h('div', { class: 'notice' }, guest.notice) : null);
  }
  if (guest.tab === 'page') {
    const view = guest.view;
    if (!view) return fill(v, h('p', { class: 'empty' }, '…'));
    if (view.http !== 200) return fill(v, h('div', { class: 'notice bad' }, `Link refused: ${view.error}`));
    const ok = view.decisions.filter((d) => d.ok);
    const lang = view.lang;
    const total = ok.reduce((a, d) => a + (guest.choice[d.kind] ? (d.kind === 'late' ? d.options.find((o) => o.until === guest.choice.late).price : d.total) : 0), 0);
    const card = (d) => {
      const line = E.offerLine(d, E.HOTEL, lang);
      const on = !!guest.choice[d.kind];
      const box = h('input', { type: 'checkbox', 'data-offer': d.kind, checked: on ? true : null, 'aria-label': line.title });
      box.addEventListener('change', () => { guest.choice[d.kind] = box.checked ? (d.kind === 'late' ? d.options.find((o) => o.ok).until : true) : undefined; renderGuest(); });
      const detail = d.kind === 'late' ? h('div', { class: 'times', role: 'radiogroup', 'aria-label': line.title }, ...d.options.filter((o) => o.ok).map((o) => {
        const r = h('input', { type: 'radio', name: 'late', value: o.until, checked: guest.choice.late === o.until ? true : null });
        r.addEventListener('change', () => { guest.choice.late = o.until; renderGuest(); });
        return h('label', null, r, ` ${o.until} · ${E.money(o.price, 'EUR', lang)}`);
      })) : h('small', null, d.nights ? `${d.nights} × ${line.price}` : line.price);
      const title = d.kind === 'late' ? E.STRINGS[lang].late(guest.choice.late || d.options.find((o) => o.ok).until) : line.title;
      return h('label', { class: 'offer' + (on ? ' on' : '') }, box, h('span', null, h('b', null, title), detail), h('span', { class: 'price num' }, E.money(d.kind === 'late' ? (d.options.find((o) => o.until === guest.choice.late) || d.options.find((o) => o.ok)).price : d.total, 'EUR', lang)));
    };
    const picked = Object.keys(guest.choice).filter((k) => guest.choice[k]);
    return fill(v, 
      h('h3', null, E.STRINGS[lang].hi(res.guest.first)),
      h('p', null, PAGE[lang].stay(E.fmtDate(res.arrival, lang), E.fmtDate(res.departure, lang)), ', ', roomName(res.roomType, lang), '.'),
      ok.length ? h('p', null, PAGE[lang].choose) : h('p', null, PAGE[lang].nothing),
      ...ok.map(card),
      ok.length ? h('div', { class: 'total' }, h('span', null, PAGE[lang].total), h('b', { class: 'num' }, E.money(total, 'EUR', lang))) : null,
      ok.length ? h('button', { class: 'cta', type: 'button', 'data-act': 'confirm', disabled: picked.length ? null : true, onclick: confirm }, PAGE[lang].confirm) : null);
  }
  if (guest.tab === 'done') {
    const o = guest.order;
    if (!o) return fill(v, h('p', { class: 'empty' }, '—'));
    const lang = langOf(res);
    return fill(v, 
      h('div', { class: 'confirm-box' }, h('h3', null, PAGE[lang].booked), h('p', null, PAGE[lang].bookedSub),
        h('ul', { class: 'lines' }, ...o.items.filter((i) => i.ok).map((i) => h('li', null, h('b', null, i.label), ' ', E.money(i.total, 'EUR', lang)))),
        h('div', { class: 'total' }, h('span', null, PAGE[lang].total), h('b', { class: 'num' }, E.money(o.total, 'EUR', lang))),
        h('p', { class: 'fine' }, `${PAGE[lang].ref} ${o.id.split('-').slice(-2).join('').toUpperCase()}`)),
      ...o.items.filter((i) => !i.ok).map((i) => {
        const s = E.STRINGS[lang];
        const name = i.label || (i.kind === 'upgrade' ? s.upgrade(roomName(i.to || 'SUP', lang)) : i.kind === 'late' ? s.late(i.until || '13:00') : s[i.kind]);
        return h('div', { class: 'notice bad' }, `${PAGE[lang].notBooked}: ${name}, ${PAGE[lang].sold}.`);
      }));
  }
}

async function openOffer(token) {
  const res = getRes(sel);
  const tok = token || (await desk.links(res)).offerToken;
  guest.token = tok;
  guest.view = await desk.openOffer(tok);
  if (guest.view.http === 200 && !Object.keys(guest.choice).length) guest.choice = {};
  renderAll();
}

async function confirm() {
  const selection = Object.entries(guest.choice).filter(([, v]) => v).map(([k, v]) => (k === 'late' ? { kind: 'late', until: v } : { kind: k }));
  if (flags.race && selection.some((s) => s.kind === 'parking')) await raceForLastSpace(selection);
  else { const r = await desk.accept(guest.token, selection); guest.order = r.order; }
  guest.tab = 'done';
  guest.choice = {};
  renderAll();
}

/** Another guest books the last parking space on one of our nights at the same moment. */
async function raceForLastSpace(selection) {
  const res = getRes(sel);
  const night = res.arrival;
  const rival = reservations.find((r) => r.id !== res.id && r.arrival <= night && r.departure > night && r.status !== 'canceled' && !desk.state(r.id).bought.includes('parking') && E.daysBetween(r.arrival, r.departure) === 1 && r.arrival === night)
    || reservations.find((r) => r.id !== res.id && r.arrival === night && !desk.state(r.id).bought.includes('parking'));
  const free = E.freeParking(store, desk.rules, night);
  if (free > 1) store.force([`parking:${night}`], free - 1);
  desk.log(res.id, 'ORDER', `1 parking space left on ${night}; ${guestName(rival)} books at the same moment`);
  const rivalTok = (await desk.links(rival)).offerToken;
  const [theirs, mine] = await Promise.all([desk.accept(rivalTok, [{ kind: 'parking' }]), desk.accept(guest.token, selection)]);
  desk.log(res.id, 'ORDER', `${guestName(rival)} ${theirs.order.items[0].ok ? 'got' : 'missed'} the last space; each counter is taken in one step, so it is sold once`);
  guest.order = mine.order;
}

async function unsubscribe(token) {
  await desk.unsubscribe(token);
  guest.notice = PAGE[langOf(getRes(sel))].unsub;
  renderAll();
}

// ------------------------------------------------------------------ operations pane
function renderOps() {
  const tabs = ['decisions', 'timeline', 'inventory', 'outbox', 'results', 'rules'];
  const label = { decisions: 'Why these offers', timeline: 'Timeline', inventory: 'Inventory', outbox: 'Outbox', results: 'Results', rules: 'Rules' };
  fill($('#ops-tabs'), ...tabs.map((id) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(opsTab === id), 'data-otab': id, onclick: () => { opsTab = id; renderOps(); } }, label[id])));
  const body = $('#ops-body');
  const res = getRes(sel);
  if (opsTab === 'decisions') {
    const st = desk.state(sel);
    const ds = res.status === 'canceled' ? [] : E.decideOffers({ store, hotel: E.HOTEL, rules: desk.rules, res, bought: st.bought });
    const jobs = store.list('job', sel).filter((j) => j.status === 'pending' && j.type === 'email').sort((a, b) => a.at - b.at);
    const priceOf = (d) => (d.kind === 'late' ? (d.ok ? `from ${eur(d.price)}` : '') : d.total ? eur(d.total) : '');
    fill(body, 
      h('p', { class: 'sub' }, `${guestName(res)}: ${dayStr(res.arrival)} to ${dayStr(res.departure)}, ${roomName(res.roomType)}, ${res.adults} adult${res.adults > 1 ? 's' : ''}${res.children ? ` + ${res.children} child` : ''}, ${res.purpose}, ${res.channel}${res.notes ? `, note: “${res.notes}”` : ''}. Offers are ordered by fit for this guest.`),
      res.status === 'canceled' ? h('div', { class: 'notice bad' }, 'Reservation canceled: no offers, pending emails stopped.') : null,
      ...ds.map((d) => h('div', { class: 'dec ' + (d.ok ? 'ok' : 'no') }, h('span', { class: 'mark', 'aria-hidden': 'true' }, d.ok ? '✓' : '–'),
        h('b', null, KIND[d.kind] + (d.kind === 'upgrade' && d.ok ? ` to ${roomName(d.to)}` : ''), d.ok ? h('span', { class: 'sr' }, ' offered') : h('span', { class: 'sr' }, ' not offered')),
        h('span', { class: 'money num' }, priceOf(d)), h('p', null, d.reason, h('span', { class: 'score' }, `  · fit ${d.score.toFixed(1)}`)))),
      h('h3', { class: 'sub' }, 'Next emails for this guest'),
      jobs.length ? h('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': 'Scheduled emails' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Email'), h('th', { scope: 'col' }, 'Goes out (hotel time)'), h('th', { scope: 'col' }, 'Kind'))),
        h('tbody', null, ...jobs.map((j) => h('tr', null, h('td', null, j.payload.message), h('td', { class: 'when' }, localStr(j.at)), h('td', null, j.payload.promotional ? 'offer, with one-click unsubscribe' : 'transactional')))))) : h('p', { class: 'sub' }, 'Nothing scheduled.'));
  } else if (opsTab === 'timeline') {
    const logs = store.tail(120, sel).reverse();
    fill(body, h('p', { class: 'sub' }, `Everything the automation did for ${guestName(res)}, newest first.`),
      h('ul', { class: 'log', tabindex: '0', 'aria-label': 'Timeline' }, ...logs.map((l) => h('li', null, h('time', null, localStr(l.t, false)), h('span', { class: 'cat ' + l.cat }, l.cat), h('span', null, l.msg)))));
  } else if (opsTab === 'inventory') {
    const nights = Array.from({ length: 14 }, (_, i) => E.addDays('2026-11-22', i));
    const mine = new Set(E.nightsOf(res.arrival, res.departure));
    const meter = (used, cap, isMine) => h('span', { class: 'meter', role: 'img', 'aria-label': `${used} of ${cap} used` }, ...Array.from({ length: cap }, (_, i) => h('i', { class: i < used ? (isMine && i === used - 1 && desk.state(sel).bought.includes('parking') ? 'u mine' : 'u') : '' })));
    fill(body, h('p', { class: 'sub' }, `Live counters. Highlighted rows are ${guestName(res)}’s nights.`),
      h('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': 'Inventory' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ...['Night', 'Rooms sold', 'Parking (10)', 'Late 13:00', 'Late 15:00', 'Free SUP', 'Free JRS', 'Free FAM'].map((x, i) => h('th', { scope: 'col', class: i > 2 ? 'r' : null }, x)))),
        h('tbody', null, ...nights.map((n) => h('tr', { style: null, class: mine.has(n) ? 'mine' : null },
          h('td', null, mine.has(n) ? h('b', null, dayStr(n)) : dayStr(n)), h('td', { class: 'num' }, `${Math.round(E.occupancy(store, E.HOTEL, n) * 100)}%`),
          h('td', null, meter(store.getCount(`parking:${n}`), desk.rules.parking.spaces, mine.has(n))),
          h('td', { class: 'r num' }, `${E.freeLate(store, desk.rules, n, '13:00')} left`), h('td', { class: 'r num' }, `${E.freeLate(store, desk.rules, n, '15:00')} left`),
          ...['SUP', 'JRS', 'FAM'].map((c) => h('td', { class: 'r num' }, String(E.freeRooms(store, E.HOTEL, c, n))))))))));
  } else if (opsTab === 'outbox') {
    const jobs = store.list('job').filter((j) => j.type !== 'email' || j.attempts > 0 || j.status === 'dead').sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
    const sw = (key, label) => h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(key === 'down' ? pmsState.down : pmsState.failNext > 0), 'data-sw': key, onclick: () => { if (key === 'down') pmsState.down = !pmsState.down; else pmsState.failNext = pmsState.failNext ? 0 : 2; desk.log(null, 'RETRY', key === 'down' ? `PMS folio API ${pmsState.down ? 'down' : 'back up'}` : `PMS will fail the next ${pmsState.failNext} calls`); renderOps(); } }, label);
    const status = (j) => h('span', { class: 'badge ' + ({ done: 'ok', pending: j.attempts ? 'warn' : '', dead: 'bad', running: 'warn' }[j.status] || '') }, j.status === 'pending' && j.attempts ? `retry ${j.attempts}` : j.status);
    fill(body, 
      h('p', { class: 'sub' }, 'Folio charges, PMS room changes and CRM events go through an outbox: each has an idempotency key, retries after 1, 5, 15, 60 and 240 minutes, then lands on the dead-letter list with an alert.'),
      h('div', { class: 'switches' }, sw('down', 'PMS folio API down'), sw('fail', 'PMS fails next 2 calls'), h('button', { class: 'btn small primary', type: 'button', 'data-act': 'run-due', onclick: async () => { await desk.runDue(); renderAll(); } }, 'Run due jobs now')),
      h('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': 'Outbox jobs' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ...['Job', 'Booking', 'Status', 'Idempotency key'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', null, ...jobs.map((j) => h('tr', null, h('td', null, j.type === 'folio' ? `charge ${j.kind}` : j.type === 'void' ? `refund ${j.kind}` : j.type === 'email' ? `email ${j.payload.message}` : j.type === 'amend' ? 'PMS room change' : 'CRM event'),
          h('td', { class: 'nw' }, String(j.resId).replace('RSV-', '')), h('td', { class: 'nw' }, status(j), j.status === 'pending' && j.attempts ? h('small', null, ` next ${localStr(j.at, false).slice(-5)}`) : null), h('td', null, h('code', null, (j.idemKey || j.id).slice(-18)))))))),
      h('p', { class: 'sub' }, `Charges received by the PMS: ${charges.length}. Distinct idempotency keys: ${new Set(charges.map((c) => c.idemKey)).size}.`));
  } else if (opsTab === 'results') {
    const s = desk.summary();
    const kp = (label, val) => h('div', { class: 'kpi' }, h('span', null, label), h('b', { class: 'num' }, val));
    const fun = (label, n, of) => h('div', null, h('span', null, label), h('span', { class: 'bar', role: 'img', 'aria-label': `${n} of ${of}` }, h('i', { style: `width:${of ? Math.round((100 * n) / of) : 0}%` })), h('span', { class: 'num' }, n));
    const rows = Object.entries(s.byKind);
    fill(body, 
      h('div', { class: 'kpis' }, kp('Offer emails sent', s.offerEmails), kp('Guests who opened the page', s.clicked), kp('Guests who booked', s.buyers), kp('Extras booked', eur(s.revenue))),
      h('div', { class: 'funnel' }, fun('Guests emailed', s.guestsEmailed, s.guestsEmailed), fun('Opened the offer page', s.clicked, s.guestsEmailed), fun('Booked something', s.buyers, s.guestsEmailed)),
      h('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': 'Revenue by extra' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Extra'), h('th', { scope: 'col', class: 'r' }, 'Sold'), h('th', { scope: 'col', class: 'r' }, 'Revenue'))),
        h('tbody', null, ...(rows.length ? rows.map(([k, v]) => h('tr', null, h('td', null, KIND[k]), h('td', { class: 'r num' }, v.count), h('td', { class: 'r num' }, eur(v.revenue)))) : [h('tr', null, h('td', { colspan: '3' }, 'Nothing booked yet in this session.'))])))),
      h('p', { class: 'sub' }, 'Responses are counted from page visits and bookings, not email opens: Apple Mail Privacy Protection loads images on delivery, so open pixels overstate interest. Numbers here are only what happened in this demo session.'),
      h('p', { class: 'sub' }, `Unsubscribed: ${s.unsubscribed}. Jobs waiting: ${s.pendingJobs}, retrying: ${s.retrying}, dead-letter: ${s.dead}. CRM events sent: ${crmEvents.length}.`));
  } else if (opsTab === 'rules') {
    const r = desk.rules;
    const fld = (path, label, step = '1') => { const [a, b] = path.split('.'); return h('label', null, label, h('input', { type: 'number', step, name: path, value: r[a][b], inputmode: 'decimal' })); };
    const form = h('form', { onsubmit: (ev) => {
      ev.preventDefault();
      const next = structuredClone(desk.rules);
      for (const el of form.querySelectorAll('input')) { const [a, b] = el.name.split('.'); next[a][b] = parseFloat(el.value); }
      const errs = [];
      if (!(next.parking.spaces >= 0 && Number.isInteger(next.parking.spaces))) errs.push('parking spaces must be a whole number');
      if (next.upgrade.discount < 0 || next.upgrade.discount > 0.9) errs.push('upgrade discount must be between 0 and 0.9');
      if (!(next.timing.preArrivalDays >= 1 && next.timing.preArrivalDays <= 30)) errs.push('offer email must go 1 to 30 days before arrival');
      if (errs.length) ruleMsg = { ok: false, text: errs.join('; ') };
      else { desk.rules = next; ruleMsg = { ok: true, text: 'Saved. Offers and prices use the new rules from now on; emails already scheduled keep their time.' }; desk.log(null, 'ORDER', 'rules updated'); }
      renderAll();
    } },
      h('div', { class: 'rules' }, fld('breakfast.adult', 'Breakfast per adult (€)'), fld('breakfast.child', 'Breakfast per child (€)'), fld('parking.perNight', 'Parking per night (€)'), fld('parking.spaces', 'Parking spaces'),
        fld('upgrade.discount', 'Upgrade discount (0 to 0.9)', '0.05'), fld('upgrade.keepUnsold', 'Rooms kept back per type'), fld('timing.preArrivalDays', 'Offer email, days before arrival'), fld('timing.reminderDays', 'Reminder, days before arrival'), fld('timing.maxOfferEmails', 'Max offer emails per stay')),
      ruleMsg ? h('div', { class: 'msg ' + (ruleMsg.ok ? 'ok' : 'bad'), role: 'status' }, ruleMsg.text) : null,
      h('p', null, h('button', { class: 'btn primary', type: 'submit', 'data-act': 'save-rules' }, 'Save rules')));
    fill(body, h('p', { class: 'sub' }, 'What the hotel team edits without a developer. Late checkout slots and room counts live in the same settings.'), form);
  }
}

function renderAll() { renderLeft(); renderGuest(); renderOps(); }

// ------------------------------------------------------------------ clock and PMS buttons
async function advance(to) {
  t = Math.max(t, to);
  await desk.runDue();
  renderAll();
}
async function nextEmail() {
  const next = store.list('job', sel).filter((j) => j.status === 'pending' && j.type === 'email').sort((a, b) => a.at - b.at)[0];
  if (!next) { say('No email waiting for this guest.'); return; }
  await advance(next.at);
  guest.tab = 'inbox'; guest.mail = null;
  renderGuest();
}
let newN = 0;
function newReservation() {
  newN++;
  const arrival = E.addDays(E.localDate(t, tz()), 9);
  return { id: `RSV-NEW${newN}`, guest: { first: ['Chloé', 'Lukas', 'Emma', 'Tiago'][newN % 4], last: ['Girard', 'Weber', 'Hughes', 'Rocha'][newN % 4], email: `new${newN}@example.com`, language: ['fr', 'de', 'en', 'pt'][newN % 4], country: ['FR', 'DE', 'GB', 'PT'][newN % 4] },
    arrival, departure: E.addDays(arrival, 3), roomType: 'SUP', adults: 2, children: 0, ratePlan: 'RO', rate: 159, channel: 'Direct', notes: '', purpose: 'leisure', status: 'confirmed', version: 1 };
}
async function pmsButton(kind) {
  const res = getRes(sel);
  if (kind === 'new' || kind === 'dup' || kind === 'cancel-first') {
    const r = newReservation();
    extraRes.push(r);
    if (kind === 'cancel-first') {
      await pmsEvent('reservation.canceled', { id: r.id }, { ts: t + 2000 });
      await pmsEvent('reservation.created', r, { ts: t + 1000 });
    } else {
      const id = `evt-${r.id}`;
      for (let i = 0; i < (kind === 'dup' ? 3 : 1); i++) await pmsEvent('reservation.created', r, { id });
    }
    await desk.runDue();
    select(r.id);
    opsTab = 'timeline';
  } else if (kind === 'change') {
    await pmsEvent('reservation.changed', { ...res, arrival: E.addDays(res.arrival, 1), departure: E.addDays(res.departure, 1) }, { ts: t + 1000 });
    opsTab = 'timeline';
  } else if (kind === 'cancel') {
    await pmsEvent('reservation.canceled', { id: res.id }, { ts: t + 1000 });
    await desk.runDue();
    opsTab = 'timeline';
  } else if (kind === 'forged') {
    await pmsEvent('reservation.created', newReservation(), { forged: true });
    opsTab = 'timeline';
    desk.log(sel, 'SEC', 'a forged webhook was refused (see the hotel-wide log for the 401)');
  }
  renderAll();
}

// ------------------------------------------------------------------ autoplay
let runId = 0, playing = false;
const say = (m) => { $('#run-status').textContent = m; };
const sleep = (ms) => new Promise((r) => setTimeout(r, REDUCE ? Math.min(ms, 80) : ms));
async function click(selector) { const el = $(selector); if (el && !el.disabled) { el.click(); await sleep(60); return true; } return false; }
async function play(kind) {
  await reset();
  const my = ++runId; playing = true;
  const alive = () => my === runId;
  const step = async (ms, msg) => { if (msg) say(msg); await sleep(ms); return alive(); };
  try {
    if (kind === 'journey') {
      opsTab = 'decisions'; renderOps();
      const LANG = { en: 'English', pt: 'Portuguese', fr: 'French', de: 'German' };
      if (!await step(2200, `${guestName(featured)} arrives ${dayStr(featured.arrival)} for ${E.daysBetween(featured.arrival, featured.departure)} nights on a room-only rate${featured.notes ? ' and wrote that they come by car' : ''}. The hotel console shows why each extra is offered or held back.`)) return;
      await click('[data-act="next-email"]');
      if (!await step(1600, `The clock moves to 10:00 hotel time, 7 days before arrival: the offer email goes out in ${LANG[featured.guest.language]}, with one-click unsubscribe headers.`)) return;
      await click('[data-mail]');
      if (!await step(2000)) return;
      await click('[data-act="open-offer"]');
      if (!await step(1500, 'The guest opens the offer page: availability is checked again at this moment.')) return;
      for (const k of ['breakfast', 'parking', 'late']) { const el = $(`[data-offer="${k}"]`); if (el && !el.checked) { el.click(); await sleep(500); } if (!alive()) return; }
      if (!await step(1200, flags.race ? 'Only one parking space is left on the arrival night, and another guest books it at the same moment.' : 'Breakfast, parking and late checkout selected.')) return;
      await click('[data-act="confirm"]');
      if (!await step(1800, 'Booked. The confirmation shows at once; charges for the folio wait in the outbox.')) return;
      opsTab = 'outbox'; renderOps();
      if (flags.pmsDown) { pmsState.down = true; desk.log(null, 'RETRY', 'PMS folio API down'); renderOps(); }
      if (!await step(1500)) return;
      await click('[data-act="run-due"]');
      if (flags.pmsDown) {
        if (!await step(2200, 'The PMS is down: each charge waits and retries after 1, 5 and 15 minutes, with the same idempotency key.')) return;
        await advance(t + 60000); if (!await step(1200)) return;
        pmsState.down = false; desk.log(null, 'RETRY', 'PMS folio API back up');
        await advance(t + 5 * 60000);
        if (!await step(2200, 'The PMS is back: every charge posts once.')) return;
      } else if (!await step(1800, 'Charges posted to the guest folio, receipt emailed, CRM updated.')) return;
      opsTab = 'timeline'; renderOps();
      if (!await step(2600, 'The timeline shows every step for this guest.')) return;
      opsTab = 'results'; renderOps();
      say('Done. Try the problems above, or click through any guest yourself.');
    } else {
      opsTab = 'timeline'; renderOps();
      if (!await step(1500, 'The PMS sends a new booking three times (at-least-once delivery).')) return;
      await pmsButton('dup');
      if (!await step(2600, 'One reservation, one confirmation email: the repeats are recognised by event id.')) return;
      await pmsButton('cancel-first');
      if (!await step(2800, 'Here the cancellation arrives before the booking. The late booking event is older, so it is ignored and the guest gets no email.')) return;
      await pmsButton('forged');
      if (!await step(2200, 'A webhook with a wrong signature is refused with 401.')) return;
      select(featured.id); opsTab = 'decisions'; renderAll();
      await pmsButton('change');
      if (!await step(2400, 'A date change re-plans the emails and moves any parking or late checkout already bought.')) return;
      opsTab = 'decisions'; renderOps();
      say('Done. Every PMS event and its effect is in the timeline.');
    }
  } finally { if (my === runId) playing = false; }
}
async function reset() {
  runId++;
  t = T0; inbox.clear(); charges.length = 0; crmEvents.length = 0; extraRes.length = 0; newN = 0;
  Object.assign(pmsState, { down: false, failNext: 0, keys: new Map() });
  ruleMsg = null;
  await boot();
}

// ------------------------------------------------------------------ start
document.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => play(b.dataset.play)));
document.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', () => { flags[b.dataset.flag] = !flags[b.dataset.flag]; b.setAttribute('aria-pressed', String(flags[b.dataset.flag])); }));
$('#reset').addEventListener('click', async () => { await reset(); say('Reset to Sunday 22 November, 09:00.'); });
document.querySelectorAll('[data-pms]').forEach((b) => b.addEventListener('click', () => pmsButton(b.dataset.pms)));
$('#desk').addEventListener('pointerdown', (e) => { if (e.isTrusted && playing) { runId++; playing = false; say('Manual mode: you are driving the demo.'); } });
await boot();
say('Press a play button, or pick a guest and use the clock.');
window.__demo = { play, reset, state: () => ({ sel, guestTab: guest.tab, order: guest.order, charges: charges.length, chargeKeys: new Set(charges.map((c) => c.idemKey)).size, inbox: [...inbox.values()].reduce((a, l) => a + l.length, 0), summary: desk.summary(), playing, dead: store.list('job').filter((j) => j.status === 'dead').length }), flags, desk: () => desk, store: () => store, inboxOf: (id) => (inbox.get(id) || []).map((m) => ({ subject: m.subject, type: m.type, promotional: m.promotional, unsub: m.headers['List-Unsubscribe-Post'] || null })), res: (id) => getRes(id), featured: () => featured && featured.id, logs: (id) => store.tail(500, id) };

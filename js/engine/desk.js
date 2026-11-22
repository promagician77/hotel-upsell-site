// The upsell desk: PMS events in, scheduled emails out, offer page, acceptance, folio
// charges and CRM events through an outbox with retries. The same class runs behind the
// HTTP server (SQLite store) and in the browser demo (memory store).
import { HOTEL, DEFAULT_RULES } from './hotel.js';
import { decideOffers, inventoryFor } from './offers.js';
import { planMessages } from './schedule.js';
import { occupy } from './inventory.js';
import { nightsOf, zonedToUtc, addDays } from './time.js';
import { hmacHex, safeEqual, signToken, verifyToken } from './crypto.js';
import { buildEmail, offerLine, STRINGS } from './email.js';

export const BACKOFF_MIN = [1, 5, 15, 60, 240]; // minutes between attempts; then dead-letter
const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

export class Desk {
  constructor({ store, hotel = HOTEL, rules = DEFAULT_RULES, secret, webhookSecret, baseUrl = 'https://offers.meridiana.example', clock = () => Date.now(), adapters, naive = false }) {
    Object.assign(this, { store, hotel, rules, secret, webhookSecret, baseUrl, clock, adapters, naive });
    this.seq = 0;
  }

  now() { return this.clock(); }
  log(resId, cat, msg, extra = {}) { this.store.append({ t: this.now(), resId, cat, msg, ...extra }); }
  id(prefix) { this.seq++; return `${prefix}-${this.now().toString(36)}-${this.seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }
  state(resId) { return this.store.get('state', resId) || { sent: [], bought: [], clicked: false, unsubscribed: false }; }
  setState(resId, s) { this.store.put('state', resId, s); }

  // ---------------------------------------------------------------- PMS webhooks
  /** raw: request body string; signature: 'sha256=<hex>' header. */
  async handlePmsEvent(raw, signature) {
    if (this.webhookSecret) {
      const want = 'sha256=' + (await hmacHex(this.webhookSecret, raw));
      if (!safeEqual(signature || '', want)) { this.log(null, 'SEC', 'PMS webhook with a bad signature refused'); return { http: 401, action: 'bad_signature' }; }
    }
    let ev;
    try { ev = JSON.parse(raw); } catch { return { http: 400, action: 'bad_json' }; }
    if (!ev.id || !ev.type || !ev.timestamp || !ev.reservation?.id) return { http: 400, action: 'missing_fields' };
    if (this.store.get('event', ev.id)) { this.log(ev.reservation.id, 'PMS', `duplicate event ${ev.id.slice(0, 8)} ignored`); return { http: 200, action: 'duplicate' }; }
    this.store.put('event', ev.id, { at: this.now(), type: ev.type });
    const id = ev.reservation.id;
    const cur = this.store.get('res', id);
    if (cur && ev.timestamp <= cur.lastEventTs) {
      this.log(id, 'PMS', `${ev.type} from ${new Date(ev.timestamp).toISOString().slice(11, 19)} is older than what we have; ignored`);
      return { http: 200, action: 'stale' };
    }
    if (ev.type === 'reservation.canceled') return this.cancel(id, cur, ev);
    const next = { ...ev.reservation, status: 'confirmed', lastEventTs: ev.timestamp };
    // an upgrade sold here may not have reached the PMS yet: keep it
    if (cur?.upgradedFrom && next.roomType === cur.upgradedFrom) Object.assign(next, { roomType: cur.roomType, upgradedFrom: cur.upgradedFrom });
    else if (cur?.upgradedFrom && next.roomType === cur.roomType) next.upgradedFrom = cur.upgradedFrom;
    if (cur && cur.status !== 'canceled') occupy(this.store, cur, -1);
    occupy(this.store, next, +1);
    this.store.put('res', id, next);
    if (cur && cur.status !== 'canceled' && (cur.arrival !== next.arrival || cur.departure !== next.departure)) this.moveOrders(cur, next);
    this.log(id, 'PMS', cur ? `reservation changed (${next.arrival} to ${next.departure})` : `reservation created (${next.arrival} to ${next.departure}, ${next.roomType})`);
    this.reschedule(next);
    return { http: 200, action: cur ? 'changed' : 'created' };
  }

  cancel(id, cur, ev) {
    if (cur && cur.status !== 'canceled') occupy(this.store, cur, -1);
    const res = { ...(cur || { id }), status: 'canceled', lastEventTs: ev.timestamp };
    this.store.put('res', id, res);
    // drop unsent messages, give back inventory, void charges
    for (const j of this.store.list('job', id)) if (j.status === 'pending' && j.type === 'email') this.store.put('job', j.id, { ...j, status: 'canceled' });
    for (const o of this.store.list('order', id)) {
      if (o.voided) continue;
      for (const it of o.items) {
        if (!it.ok) continue;
        if (it.keys?.length) this.store.release(it.keys); // an upgrade moved the reservation itself, released above
        this.enqueue({ type: 'void', resId: id, orderId: o.id, kind: it.kind, idemKey: `${o.id}:${it.kind}:void`, payload: { amount: -it.total, label: it.label } });
      }
      this.store.put('order', o.key, { ...o, voided: true });
    }
    this.log(id, 'PMS', cur ? 'reservation canceled; pending emails stopped, extras released' : 'cancellation arrived before the booking; kept so the late booking event is ignored');
    return { http: 200, action: cur ? 'canceled' : 'canceled_tombstone' };
  }

  /** Dates changed: move parking and late checkout to the new dates, or flag for staff. */
  moveOrders(prev, next) {
    for (const o of this.store.list('order', prev.id)) {
      if (o.voided) continue;
      let changed = false;
      for (const it of o.items) {
        if (!it.ok || !['parking', 'late'].includes(it.kind)) continue; // an upgrade travels with the reservation
        if (it.keys?.length) this.store.release(it.keys);
        const entries = inventoryFor(it, { hotel: this.hotel, rules: this.rules, res: next });
        if (this.store.tryTake(entries)) { it.keys = entries.map((e) => e.key); this.log(prev.id, 'ORDER', `${it.kind} moved to the new dates`); }
        else { it.keys = []; it.attention = 'not available on the new dates'; this.log(prev.id, 'ALERT', `${it.kind} not available on the new dates; staff to contact guest`); }
        changed = true;
      }
      if (changed) this.store.put('order', o.key, o);
    }
  }

  // ---------------------------------------------------------------- scheduling
  reschedule(res) {
    for (const j of this.store.list('job', res.id)) if (j.status === 'pending' && j.type === 'email' && j.payload.message !== 'receipt') this.store.put('job', j.id, { ...j, status: 'replaced' });
    const plan = planMessages({ res, now: this.now(), hotel: this.hotel, rules: this.rules, state: this.state(res.id) });
    for (const p of plan) this.enqueue({ type: 'email', resId: res.id, at: p.at, payload: { message: p.type, promotional: p.promotional } });
    return plan;
  }

  enqueue(job) {
    const j = { id: this.id('job'), status: 'pending', attempts: 0, at: this.now(), createdAt: this.now(), ...job };
    this.store.put('job', j.id, j);
    return j;
  }

  async links(res) {
    const exp = zonedToUtc(res.departure, 12, 0, this.hotel.timeZone);
    const offer = await signToken(this.secret, { r: res.id, p: 'offer', exp });
    const unsub = await signToken(this.secret, { r: res.id, p: 'unsub' });
    return { offer: `${this.baseUrl}/o/${offer}`, unsubscribe: `${this.baseUrl}/u/${unsub}`, offerToken: offer, unsubToken: unsub };
  }

  // ---------------------------------------------------------------- outbox worker
  async runDue(limit = 500) {
    const now = this.now();
    const due = this.store.list('job').filter((j) => j.status === 'pending' && j.at <= now).sort((a, b) => a.at - b.at).slice(0, limit);
    let done = 0;
    for (const j of due) {
      if (!this.store.claim('job', j.id, 'pending', 'running')) continue; // another worker has it
      try {
        const out = await this.perform(j);
        this.store.put('job', j.id, { ...j, status: out === 'skipped' ? 'skipped' : 'done', attempts: j.attempts + 1, doneAt: this.now(), result: out });
        done++;
      } catch (e) {
        const attempts = j.attempts + 1;
        if (attempts >= MAX_ATTEMPTS || e.permanent) {
          this.store.put('job', j.id, { ...j, status: 'dead', attempts, error: String(e.message || e) });
          this.log(j.resId, 'ALERT', `${j.type} failed ${attempts} times and went to the dead-letter list: ${e.message}`);
        } else {
          this.store.put('job', j.id, { ...j, status: 'pending', attempts, at: this.now() + BACKOFF_MIN[attempts - 1] * 60000, error: String(e.message || e) });
          this.log(j.resId, 'RETRY', `${j.type} attempt ${attempts} failed (${e.message}); next try in ${BACKOFF_MIN[attempts - 1]} min`);
        }
      }
    }
    return done;
  }

  async perform(j) {
    const res = this.store.get('res', j.resId);
    if (j.type === 'email') {
      const kind = j.payload.message;
      if (!res || res.status === 'canceled') return 'skipped';
      const st = this.state(res.id);
      if (j.payload.promotional && st.unsubscribed) { this.log(res.id, 'EMAIL', `${kind} skipped: guest unsubscribed`); return 'skipped'; }
      if (st.sent.includes(kind) && kind !== 'receipt') return 'skipped';
      let decisions = [];
      if (j.payload.promotional) {
        decisions = decideOffers({ store: this.store, hotel: this.hotel, rules: this.rules, res, bought: st.bought });
        const wanted = kind === 'late' ? decisions.filter((d) => d.ok && d.kind === 'late') : decisions.filter((d) => d.ok);
        if (!wanted.length) { this.log(res.id, 'EMAIL', `${kind} skipped: nothing left to offer`); return 'skipped'; }
      }
      const links = await this.links(res);
      const msg = buildEmail({ type: kind, res, hotel: this.hotel, decisions, items: j.payload.items || [], links });
      const sent = await this.adapters.email.send({ ...msg, resId: res.id, idemKey: j.id });
      const s2 = this.state(res.id);
      if (kind !== 'receipt') s2.sent = [...new Set([...s2.sent, kind])];
      this.setState(res.id, s2);
      this.log(res.id, 'EMAIL', `${kind} sent (${msg.lang}${msg.promotional ? ', with one-click unsubscribe' : ''}): ${msg.subject}`, { messageId: sent?.id });
      return 'sent';
    }
    if (j.type === 'folio' || j.type === 'void') {
      const r = await this.adapters.pms.postCharge({ reservationId: j.resId, kind: j.kind, amount: j.payload.amount, label: j.payload.label, idemKey: j.idemKey });
      this.log(j.resId, 'FOLIO', `${j.type === 'void' ? 'refund' : 'charge'} ${j.payload.label} ${j.payload.amount} ${this.hotel.currency} posted to the folio (${r.chargeId})`);
      const o = this.store.list('order', j.resId).find((x) => x.id === j.orderId);
      if (o) { const it = o.items.find((i) => i.kind === j.kind); if (it) it[j.type === 'void' ? 'voidPosted' : 'posted'] = r.chargeId; this.store.put('order', o.key, o); }
      return 'posted';
    }
    if (j.type === 'amend') {
      await this.adapters.pms.amendRoomType({ reservationId: j.resId, to: j.payload.to, idemKey: j.idemKey });
      this.log(j.resId, 'PMS', `room type changed to ${j.payload.to} in the PMS`);
      return 'amended';
    }
    if (j.type === 'crm') {
      await this.adapters.crm.send({ event: j.payload.event, reservationId: j.resId, data: j.payload.data, idemKey: j.idemKey });
      this.log(j.resId, 'CRM', `${j.payload.event} sent to the CRM`);
      return 'sent';
    }
    throw Object.assign(new Error(`unknown job ${j.type}`), { permanent: true });
  }

  // ---------------------------------------------------------------- guest links
  async openOffer(token) {
    const v = await verifyToken(this.secret, token, this.now());
    if (!v.ok) return { http: v.why === 'expired' ? 410 : 401, error: v.why };
    const res = this.store.get('res', v.payload.r);
    if (!res || res.status === 'canceled') return { http: 410, error: 'reservation canceled' };
    const st = this.state(res.id);
    if (!st.clicked) { st.clicked = true; st.clickedAt = this.now(); this.setState(res.id, st); this.log(res.id, 'GUEST', 'opened the offer page'); }
    const decisions = decideOffers({ store: this.store, hotel: this.hotel, rules: this.rules, res, bought: st.bought });
    return { http: 200, res, decisions, bought: st.bought, lang: STRINGS[res.guest.language] ? res.guest.language : 'en' };
  }

  async unsubscribe(token) {
    const v = await verifyToken(this.secret, token, this.now());
    if (!v.ok || v.payload.p !== 'unsub') return { http: 401 };
    const st = this.state(v.payload.r);
    if (!st.unsubscribed) {
      st.unsubscribed = true; this.setState(v.payload.r, st);
      const res = this.store.get('res', v.payload.r);
      if (res) this.reschedule(res);
      this.log(v.payload.r, 'GUEST', 'unsubscribed from offer emails (one-click)');
      this.enqueue({ type: 'crm', resId: v.payload.r, idemKey: `${v.payload.r}:unsub`, payload: { event: 'guest.unsubscribed', data: {} } });
    }
    return { http: 200 };
  }

  /**
   * Books the selected extras. selection: [{ kind, until?, to? }]. The same token and
   * selection always return the same order, so a double click or a retried request
   * books once.
   */
  async accept(token, selection) {
    const v = await verifyToken(this.secret, token, this.now());
    if (!v.ok || v.payload.p !== 'offer') return { http: v.why === 'expired' ? 410 : 401, error: v.why || 'wrong token' };
    const res = this.store.get('res', v.payload.r);
    if (!res || res.status === 'canceled') return { http: 410, error: 'reservation canceled' };
    const canon = selection.map((s) => [s.kind, s.until || '', s.to || ''].join(':')).sort().join('|');
    const key = `${res.id}|${canon}`;
    const existing = this.store.get('order', key);
    if (existing) return { http: 200, order: existing, replay: true };
    const st = this.state(res.id);
    const decisions = decideOffers({ store: this.store, hotel: this.hotel, rules: this.rules, res, bought: st.bought });
    const lang = STRINGS[res.guest.language] ? res.guest.language : 'en';
    const items = [];
    for (const sel of selection) {
      const d = decisions.find((x) => x.kind === sel.kind);
      const item = { kind: sel.kind, ok: false };
      if (!d || !d.ok) { item.reason = d ? d.reason : 'unknown offer'; items.push(item); continue; }
      if (sel.kind === 'late') {
        const o = d.options.find((x) => x.until === sel.until && x.ok);
        if (!o) { item.reason = 'that time is no longer available'; items.push(item); continue; }
        Object.assign(item, { until: o.until, total: o.price });
      } else if (sel.kind === 'upgrade') Object.assign(item, { to: d.to, total: d.total, perNight: d.perNight });
      else Object.assign(item, { total: d.total, perNight: d.perNight });
      item.label = offerLine(sel.kind === 'late' ? { ...d, options: [{ until: item.until, price: item.total, ok: true }] } : d, this.hotel, lang).title;
      const entries = inventoryFor(item, { hotel: this.hotel, rules: this.rules, res });
      if (entries.length) {
        if (this.naive) {
          // check-then-act across a network call: the version that oversells
          await this.adapters.pms.ping?.();
          this.store.force(entries.map((e) => e.key), +1);
        } else if (!this.store.tryTake(entries)) { item.reason = 'sold out a moment ago'; items.push(item); continue; }
        item.keys = entries.map((e) => e.key);
      }
      if (sel.kind === 'upgrade') {
        // the reservation now occupies the new type; its old rooms go back on sale
        this.store.release(nightsOf(res.arrival, res.departure).map((n) => `room:${res.roomType}:${n}`));
        item.keys = [];
        item.from = res.roomType;
      }
      item.ok = true;
      items.push(item);
    }
    const order = { id: this.id('ord'), key, resId: res.id, items, total: items.filter((i) => i.ok).reduce((a, i) => a + i.total, 0), createdAt: this.now() };
    this.store.put('order', key, order);
    const okItems = items.filter((i) => i.ok);
    if (okItems.length) {
      st.bought = [...new Set([...st.bought, ...okItems.map((i) => i.kind)])];
      this.setState(res.id, st);
      const up = okItems.find((i) => i.kind === 'upgrade');
      if (up) { this.store.put('res', res.id, { ...res, roomType: up.to, upgradedFrom: res.roomType }); this.enqueue({ type: 'amend', resId: res.id, idemKey: `${order.id}:amend`, payload: { to: up.to } }); }
      for (const it of okItems) this.enqueue({ type: 'folio', resId: res.id, orderId: order.id, kind: it.kind, idemKey: `${order.id}:${it.kind}`, payload: { amount: it.total, label: it.label } });
      this.enqueue({ type: 'email', resId: res.id, payload: { message: 'receipt', promotional: false, items: okItems } });
      this.enqueue({ type: 'crm', resId: res.id, idemKey: `${order.id}:crm`, payload: { event: 'upsell.purchased', data: { items: okItems.map((i) => ({ kind: i.kind, total: i.total })), total: order.total } } });
      this.log(res.id, 'ORDER', `guest booked ${okItems.map((i) => i.kind).join(', ')} for ${order.total} ${this.hotel.currency}`);
      const fresh = this.store.get('res', res.id);
      this.reschedule(fresh);
    }
    for (const it of items.filter((i) => !i.ok)) this.log(res.id, 'ORDER', `${it.kind} not booked: ${it.reason}`);
    return { http: 200, order };
  }

  // ---------------------------------------------------------------- reporting
  summary() {
    const jobs = this.store.list('job');
    const emails = jobs.filter((j) => j.type === 'email' && j.status === 'done' && j.result === 'sent');
    const offerMails = emails.filter((j) => j.payload.promotional);
    const states = this.store.list('state');
    const orders = this.store.list('order').filter((o) => !o.voided);
    const byKind = {};
    for (const o of orders) for (const i of o.items) if (i.ok) { byKind[i.kind] = byKind[i.kind] || { count: 0, revenue: 0 }; byKind[i.kind].count++; byKind[i.kind].revenue += i.total; }
    const resWithOffer = new Set(offerMails.map((j) => j.resId));
    return {
      offerEmails: offerMails.length, guestsEmailed: resWithOffer.size,
      clicked: states.filter((s) => s.clicked).length,
      buyers: new Set(orders.filter((o) => o.items.some((i) => i.ok)).map((o) => o.resId)).size,
      revenue: orders.reduce((a, o) => a + o.total, 0), byKind,
      pendingJobs: jobs.filter((j) => j.status === 'pending').length,
      retrying: jobs.filter((j) => j.status === 'pending' && j.attempts > 0).length,
      dead: jobs.filter((j) => j.status === 'dead').length,
      unsubscribed: states.filter((s) => s.unsubscribed).length,
    };
  }
}

export { addDays };

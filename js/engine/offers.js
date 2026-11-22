// Which offers a guest gets, at what price, and why. Every decision carries a reason the
// admin can read ("2 of 10 spaces left on 28 Nov", "sold out on 29 Nov").
import { nightsOf, weekday, addDays } from './time.js';
import { roomType, freeRooms, freeParking, freeLate, occupancy, roomKey } from './inventory.js';

const round = (v, step) => Math.ceil(v / step) * step;

export function upgradePrice(from, to, rules) {
  const u = rules.upgrade;
  return Math.max(u.minPerNight, round((to.rate - from.rate) * (1 - u.discount), u.roundTo));
}

/** Upgrade targets the stay can move to on every night, keeping `keepUnsold` rooms back. */
export function upgradeTargets(store, hotel, rules, res) {
  const from = roomType(hotel, res.roomType);
  const nights = nightsOf(res.arrival, res.departure);
  const guests = res.adults + res.children;
  const out = [];
  for (const to of hotel.roomTypes) {
    if (to.rank <= from.rank || to.code === from.code || guests > to.maxGuests) continue;
    const blocked = nights.find((n) => freeRooms(store, hotel, to.code, n) <= rules.upgrade.keepUnsold);
    out.push({ to: to.code, perNight: upgradePrice(from, to, rules), nights: nights.length, ok: !blocked, blockedNight: blocked || null });
  }
  return out;
}

/** All offer decisions for one reservation. `bought` lists kinds already purchased. */
export function decideOffers({ store, hotel, rules, res, bought = [] }) {
  const nights = nightsOf(res.arrival, res.departure);
  const leisure = res.purpose === 'leisure';
  const weekend = nights.some((n) => [5, 6].includes(weekday(n)));
  const out = [];
  const has = (k) => bought.includes(k);

  // Breakfast
  {
    const b = rules.breakfast;
    const perNight = res.adults * b.adult + res.children * b.child;
    const d = { kind: 'breakfast', perNight, nights: nights.length, total: perNight * nights.length, score: 0.5 + (leisure ? 0.2 : 0) + (res.children ? 0.2 : 0) };
    if (!b.enabled) Object.assign(d, { ok: false, reason: 'turned off in settings' });
    else if (res.ratePlan === 'BB') Object.assign(d, { ok: false, reason: 'rate already includes breakfast' });
    else if (has('breakfast')) Object.assign(d, { ok: false, reason: 'already bought' });
    else Object.assign(d, { ok: true, reason: `${res.adults} adult${res.adults > 1 ? 's' : ''}${res.children ? `, ${res.children} child${res.children > 1 ? 'ren' : ''}` : ''} × ${nights.length} night${nights.length > 1 ? 's' : ''}, rate is room only` });
    out.push(d);
  }
  // Parking
  {
    const p = rules.parking;
    const car = /car|carro|voiture|auto/i.test(res.notes || '');
    const near = ['PT', 'ES'].includes(res.guest.country);
    const free = nights.map((n) => freeParking(store, rules, n));
    const minFree = Math.min(...free);
    const tight = nights[free.indexOf(minFree)];
    const d = { kind: 'parking', perNight: p.perNight, nights: nights.length, total: p.perNight * nights.length, score: 0.3 + (car ? 0.6 : 0) + (near ? 0.2 : 0), minFree, tightNight: tight };
    if (!p.enabled) Object.assign(d, { ok: false, reason: 'turned off in settings' });
    else if (has('parking')) Object.assign(d, { ok: false, reason: 'already bought' });
    else if (minFree <= 0) Object.assign(d, { ok: false, reason: `no space left on ${tight}` });
    else Object.assign(d, { ok: true, reason: `${minFree} of ${p.spaces} spaces left on ${tight}${car ? '; guest mentioned a car' : ''}` });
    out.push(d);
  }
  // Room upgrade (best available target)
  {
    const targets = rules.upgrade.enabled && !has('upgrade') && nights.length <= rules.upgrade.maxNights ? upgradeTargets(store, hotel, rules, res) : [];
    const ok = targets.filter((x) => x.ok);
    const pref = res.children ? ok.find((x) => x.to === 'FAM') || ok[0] : ok.sort((a, b) => a.perNight - b.perNight)[0];
    const d = { kind: 'upgrade', score: 0.4 + (leisure && nights.length >= 2 ? 0.3 : 0) + (weekend ? 0.2 : 0), targets };
    if (!rules.upgrade.enabled) Object.assign(d, { ok: false, reason: 'turned off in settings' });
    else if (has('upgrade')) Object.assign(d, { ok: false, reason: 'already bought' });
    else if (nights.length > rules.upgrade.maxNights) Object.assign(d, { ok: false, reason: `stay longer than ${rules.upgrade.maxNights} nights` });
    else if (!targets.length) Object.assign(d, { ok: false, reason: 'already in the top room type' });
    else if (!pref) {
      const t = targets[0];
      Object.assign(d, { ok: false, reason: `${t.to} would drop to ${rules.upgrade.keepUnsold} unsold room on ${t.blockedNight}` });
    } else {
      Object.assign(d, { ok: true, to: pref.to, perNight: pref.perNight, nights: pref.nights, total: pref.perNight * pref.nights, reason: `${pref.to} free every night with ${rules.upgrade.keepUnsold} kept for full-price sale` });
    }
    out.push(d);
  }
  // Late checkout on the departure day
  {
    const lc = rules.lateCheckout;
    const dep = res.departure;
    const tightNight = occupancy(store, hotel, dep) >= lc.blockLateWhenOccupancyAbove;
    const typeFull = freeRooms(store, hotel, res.roomType, dep) <= 0;
    const opts = lc.options.map((o) => {
      const free = freeLate(store, rules, dep, o.until);
      const blocked = o.until > '13:00' && (tightNight || typeFull);
      return { until: o.until, price: o.price, free, ok: free > 0 && !blocked, why: free <= 0 ? 'no slot left' : blocked ? 'room type full that night, rooms needed early' : `${free} of ${o.slots} left` };
    });
    const any = opts.filter((o) => o.ok);
    const d = { kind: 'late', date: dep, options: opts, score: 0.3 + ([0, 1].includes(weekday(dep)) && leisure ? 0.4 : 0) + (res.purpose === 'business' ? 0.2 : 0) };
    if (!lc.enabled) Object.assign(d, { ok: false, reason: 'turned off in settings' });
    else if (has('late')) Object.assign(d, { ok: false, reason: 'already bought' });
    else if (!any.length) Object.assign(d, { ok: false, reason: `no late checkout slot on ${dep}` });
    else Object.assign(d, { ok: true, price: any[0].price, total: any[0].price, reason: opts.map((o) => `until ${o.until}: ${o.why}`).join('; ') });
    out.push(d);
  }
  return out.sort((a, b) => (b.ok - a.ok) || (b.score - a.score));
}

/** Counter entries (key and capacity) an accepted item must take. */
export function inventoryFor(item, { hotel, rules, res }) {
  const nights = nightsOf(res.arrival, res.departure);
  if (item.kind === 'parking') return nights.map((n) => ({ key: `parking:${n}`, cap: rules.parking.spaces }));
  if (item.kind === 'late') {
    const o = rules.lateCheckout.options.find((x) => x.until === item.until);
    return [{ key: `late:${item.until}:${res.departure}`, cap: o.slots }];
  }
  if (item.kind === 'upgrade') {
    const to = roomType(hotel, item.to);
    return nights.map((n) => ({ key: roomKey(item.to, n), cap: to.count - rules.upgrade.keepUnsold }));
  }
  return [];
}

export { addDays };

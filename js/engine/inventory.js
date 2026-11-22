// Inventory counters: rooms per type per night, parking spaces per night, late-checkout
// slots per day. Every sale goes through store.tryTake(), which takes all counters of an
// item at once or none of them, before any network call is made.
import { nightsOf } from './time.js';

export const roomKey = (type, night) => `room:${type}:${night}`;
export const parkingKey = (night) => `parking:${night}`;
export const lateKey = (date, until) => `late:${until}:${date}`;

export function roomType(hotel, code) {
  return hotel.roomTypes.find((t) => t.code === code);
}

/** Loads the rooms a reservation occupies into the counters (PMS data is the truth). */
export function occupy(store, res, delta = 1) {
  if (res.status === 'canceled') return;
  store.force(nightsOf(res.arrival, res.departure).map((n) => roomKey(res.roomType, n)), delta);
}

export function seedInventory(store, reservations) {
  for (const r of reservations) occupy(store, r, 1);
}

export function freeRooms(store, hotel, type, night) {
  return roomType(hotel, type).count - store.getCount(roomKey(type, night));
}

export function freeParking(store, rules, night) {
  return rules.parking.spaces - store.getCount(parkingKey(night));
}

export function freeLate(store, rules, date, until) {
  const opt = rules.lateCheckout.options.find((o) => o.until === until);
  return opt.slots - store.getCount(lateKey(date, until));
}

export function occupancy(store, hotel, night) {
  let used = 0, total = 0;
  for (const t of hotel.roomTypes) { used += store.getCount(roomKey(t.code, night)); total += t.count; }
  return used / total;
}

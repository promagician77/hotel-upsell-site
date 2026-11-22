// When each message goes out, in the hotel's local time. Offers are promotional email:
// they respect quiet hours, a per-stay cap and unsubscribes. The booking confirmation is
// transactional and always goes.
import { zonedToUtc, addDays, localParts, localDate } from './time.js';

const hm = (s) => s.split(':').map(Number);

/** Moves an instant out of quiet hours (to quietEnd the same or next local morning). */
export function outOfQuietHours(ms, hotel, rules) {
  const tz = hotel.timeZone;
  const { hh, mm } = localParts(ms, tz);
  const [qs, qsm] = hm(rules.timing.quietStart), [qe, qem] = hm(rules.timing.quietEnd);
  const mins = hh * 60 + mm, start = qs * 60 + qsm, end = qe * 60 + qem;
  if (mins >= start) return zonedToUtc(addDays(localDate(ms, tz), 1), qe, qem, tz);
  if (mins < end) return zonedToUtc(localDate(ms, tz), qe, qem, tz);
  return ms;
}

export function inQuietHours(ms, hotel, rules) {
  return outOfQuietHours(ms, hotel, rules) !== ms;
}

/**
 * Message plan for a reservation. `state` holds what already happened:
 * { unsubscribed, bought: [...kinds], clicked, sent: [...types] }.
 * Returns [{ type, at, promotional }] sorted by time, only future messages.
 */
export function planMessages({ res, now, hotel, rules, state = {} }) {
  const tz = hotel.timeZone, t = rules.timing;
  const plan = [];
  if (res.status === 'canceled') return plan;
  const sent = state.sent || [];
  const arrivalStart = zonedToUtc(res.arrival, 15, 0, tz); // check-in time
  if (!sent.includes('confirmation')) plan.push({ type: 'confirmation', at: now, promotional: false });
  if (state.unsubscribed) return plan;

  const offersSent = sent.filter((s) => s !== 'confirmation').length;
  let budget = t.maxOfferEmails - offersSent;
  const [ph, pm] = hm(t.preArrivalTime);
  // pre-arrival offer: N days before at the set local time, or soon if booked later
  if (!sent.includes('offer') && budget > 0) {
    let at = zonedToUtc(addDays(res.arrival, -t.preArrivalDays), ph, pm, tz);
    if (at < now) at = outOfQuietHours(now + 15 * 60000, hotel, rules);
    if (arrivalStart - at >= t.minLeadHours * 3600000) { plan.push({ type: 'offer', at, promotional: true }); budget--; }
  }
  // reminder: only if the guest neither clicked nor bought
  if (!sent.includes('reminder') && budget > 0 && !state.clicked && !(state.bought || []).length) {
    let at = zonedToUtc(addDays(res.arrival, -t.reminderDays), ph, pm, tz);
    const offer = plan.find((p) => p.type === 'offer');
    if (at > now && (!offer || at - offer.at >= 24 * 3600000) && arrivalStart - at >= 12 * 3600000) { plan.push({ type: 'reminder', at, promotional: true }); budget--; }
  }
  // late checkout, the evening before departure (in-stay)
  if (!sent.includes('late') && budget > 0 && !(state.bought || []).includes('late')) {
    const [lh, lm] = hm(t.lateCheckoutDayBefore);
    const at = zonedToUtc(addDays(res.departure, -1), lh, lm, tz);
    if (at > now && addDays(res.departure, -1) >= res.arrival) plan.push({ type: 'late', at: outOfQuietHours(at, hotel, rules), promotional: true });
  }
  return plan.filter((p) => p.at >= now || p.type === 'confirmation').sort((a, b) => a.at - b.at);
}

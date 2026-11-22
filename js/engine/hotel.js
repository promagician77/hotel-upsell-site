// A fictional 42-room hotel and a seeded set of reservations. Every price and capacity here
// is a placeholder the hotel replaces in Settings.
import { addDays, nightsOf } from './time.js';

export const HOTEL = {
  name: 'Hotel Meridiana',
  city: 'Lisbon',
  timeZone: 'Europe/Lisbon',
  currency: 'EUR',
  roomTypes: [
    { code: 'CLA', name: { en: 'Classic Double', pt: 'Duplo Clássico', fr: 'Double Classique', de: 'Klassisches Doppelzimmer' }, count: 22, rate: 129, rank: 1, maxGuests: 2 },
    { code: 'SUP', name: { en: 'Superior Double', pt: 'Duplo Superior', fr: 'Double Supérieure', de: 'Superior Doppelzimmer' }, count: 12, rate: 159, rank: 2, maxGuests: 2 },
    { code: 'JRS', name: { en: 'Junior Suite', pt: 'Júnior Suite', fr: 'Junior Suite', de: 'Junior Suite' }, count: 6, rate: 219, rank: 3, maxGuests: 3 },
    { code: 'FAM', name: { en: 'Family Room', pt: 'Quarto Família', fr: 'Chambre Familiale', de: 'Familienzimmer' }, count: 2, rate: 199, rank: 3, maxGuests: 4 },
  ],
};

export const DEFAULT_RULES = {
  breakfast: { enabled: true, adult: 18, child: 9 },
  parking: { enabled: true, perNight: 22, spaces: 10 },
  upgrade: { enabled: true, discount: 0.4, minPerNight: 15, roundTo: 5, keepUnsold: 1, maxNights: 7 },
  lateCheckout: { enabled: true, options: [{ until: '13:00', price: 25, slots: 6 }, { until: '15:00', price: 45, slots: 3 }], blockLateWhenOccupancyAbove: 0.95 },
  timing: { preArrivalDays: 7, preArrivalTime: '10:00', reminderDays: 2, lateCheckoutDayBefore: '18:00', quietStart: '21:00', quietEnd: '08:00', maxOfferEmails: 3, minLeadHours: 24 },
};

// xorshift32: same sequence in Node and in the browser
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const FIRST = { en: ['Emma', 'James', 'Olivia', 'Daniel', 'Grace', 'Thomas'], pt: ['Inês', 'João', 'Mariana', 'Tiago', 'Beatriz', 'Rui'], fr: ['Camille', 'Louis', 'Chloé', 'Hugo', 'Léa', 'Julien'], de: ['Anna', 'Lukas', 'Lena', 'Felix', 'Sophie', 'Jonas'] };
const LAST = { en: ['Carter', 'Hughes', 'Bennett', 'Wright', 'Murphy', 'Lewis'], pt: ['Silva', 'Costa', 'Ferreira', 'Almeida', 'Rocha', 'Matos'], fr: ['Martin', 'Bernard', 'Dubois', 'Laurent', 'Moreau', 'Girard'], de: ['Müller', 'Schmidt', 'Weber', 'Wagner', 'Becker', 'Hoffmann'] };

/** Seeded reservations arriving over `days` days from `start` (a local date). */
export function makeReservations({ start = '2026-11-22', days = 30, seed = 20261122, hotel = HOTEL } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  // fill each type to a target occupancy that varies by weekday
  const occ = new Map(); // `${type}|${night}` -> rooms used
  let n = 0;
  for (let i = -3; i < days; i++) {
    const arrival = addDays(start, i);
    for (const t of hotel.roomTypes) {
      const arrivalsToday = Math.round(t.count * (0.18 + r() * 0.22));
      for (let k = 0; k < arrivalsToday; k++) {
        const los = 1 + Math.floor(r() * r() * 6);
        const departure = addDays(arrival, los);
        const nights = nightsOf(arrival, departure);
        if (nights.some((d) => (occ.get(`${t.code}|${d}`) || 0) >= t.count)) continue;
        for (const d of nights) occ.set(`${t.code}|${d}`, (occ.get(`${t.code}|${d}`) || 0) + 1);
        const lang = pick(['en', 'en', 'pt', 'fr', 'de']);
        const children = t.code === 'FAM' ? 1 + Math.floor(r() * 2) : t.code === 'JRS' && r() < 0.3 ? 1 : 0;
        const adults = t.code === 'CLA' && r() < 0.35 ? 1 : 2;
        const business = adults === 1 && children === 0 && r() < 0.8;
        n++;
        out.push({
          id: `RSV-${String(41000 + n)}`,
          guest: { first: pick(FIRST[lang]), last: pick(LAST[lang]), email: `guest${n}@example.com`, language: lang, country: { en: pick(['GB', 'US', 'IE']), pt: pick(['PT', 'BR']), fr: pick(['FR', 'BE']), de: pick(['DE', 'AT', 'CH']) }[lang] },
          arrival, departure, roomType: t.code, adults, children,
          ratePlan: r() < 0.4 ? 'BB' : 'RO', // bed & breakfast or room only
          rate: t.rate,
          channel: pick(['Direct', 'Direct', 'Booking.com', 'Expedia']),
          notes: r() < 0.22 ? (lang === 'pt' ? 'Chegamos de carro' : lang === 'fr' ? 'Nous arrivons en voiture' : lang === 'de' ? 'Wir kommen mit dem Auto' : 'Arriving by car') : '',
          purpose: business ? 'business' : 'leisure',
          status: 'confirmed',
          createdAt: Date.UTC(2026, 9, 1) + Math.floor(r() * 50) * 86400000,
          version: 1,
        });
      }
    }
  }
  return out;
}

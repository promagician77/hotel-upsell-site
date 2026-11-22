// Guest emails in the guest's language. Offer emails are promotional: they carry the
// List-Unsubscribe and List-Unsubscribe-Post headers (RFC 8058) and a visible link.
// The booking confirmation and purchase receipts are transactional and carry neither.

export const STRINGS = {
  en: {
    hi: (n) => `Dear ${n},`, conf_s: (h) => `Your stay at ${h} is confirmed`, conf_b: (a, d, r) => `We look forward to welcoming you from ${a} to ${d} in a ${r}.`,
    offer_s: (h) => `Make your stay at ${h} even better`, offer_b: 'A few extras are still available for your dates. Add them now and they are ready when you arrive:',
    rem_s: 'Your extras are waiting', rem_b: 'Your arrival is close. These are still available for your stay:',
    late_s: 'Stay a little longer tomorrow?', late_b: 'Check out later tomorrow and enjoy a slower morning:',
    receipt_s: 'Your extras are booked', receipt_b: 'Thank you. We have added these to your stay; they will appear on your bill at checkout:',
    cta: 'See your offers', unsub: 'Stop offer emails', footer: (h, c) => `${h}, ${c}. You receive this because you have a booking with us.`,
    breakfast: 'Breakfast every morning', parking: 'Parking space', upgrade: (r) => `Upgrade to ${r}`, late: (t) => `Late checkout until ${t}`,
    per_night: 'per night', total: 'Total', from: 'from',
  },
  pt: {
    hi: (n) => `Caro/a ${n},`, conf_s: (h) => `A sua estadia no ${h} está confirmada`, conf_b: (a, d, r) => `Esperamos recebê-lo/a de ${a} a ${d} num ${r}.`,
    offer_s: (h) => `Torne a sua estadia no ${h} ainda melhor`, offer_b: 'Ainda há alguns extras disponíveis para as suas datas. Reserve agora e estarão prontos à sua chegada:',
    rem_s: 'Os seus extras esperam por si', rem_b: 'A sua chegada está próxima. Ainda estão disponíveis para a sua estadia:',
    late_s: 'Ficar um pouco mais amanhã?', late_b: 'Faça o check-out mais tarde amanhã e aproveite uma manhã tranquila:',
    receipt_s: 'Os seus extras estão reservados', receipt_b: 'Obrigado. Adicionámos estes extras à sua estadia; aparecerão na sua conta no check-out:',
    cta: 'Ver as ofertas', unsub: 'Deixar de receber ofertas', footer: (h, c) => `${h}, ${c}. Recebe este email porque tem uma reserva connosco.`,
    breakfast: 'Pequeno-almoço todas as manhãs', parking: 'Lugar de estacionamento', upgrade: (r) => `Upgrade para ${r}`, late: (t) => `Check-out tardio até às ${t}`,
    per_night: 'por noite', total: 'Total', from: 'desde',
  },
  fr: {
    hi: (n) => `Bonjour ${n},`, conf_s: (h) => `Votre séjour à l’${h} est confirmé`, conf_b: (a, d, r) => `Nous serons ravis de vous accueillir du ${a} au ${d} en ${r}.`,
    offer_s: (h) => `Rendez votre séjour à l’${h} encore meilleur`, offer_b: 'Quelques extras sont encore disponibles pour vos dates. Réservez-les maintenant, ils seront prêts à votre arrivée :',
    rem_s: 'Vos extras vous attendent', rem_b: 'Votre arrivée approche. Ces extras sont encore disponibles :',
    late_s: 'Rester un peu plus longtemps demain ?', late_b: 'Libérez la chambre plus tard demain et profitez d’une matinée tranquille :',
    receipt_s: 'Vos extras sont réservés', receipt_b: 'Merci. Nous avons ajouté ces extras à votre séjour ; ils figureront sur votre note au départ :',
    cta: 'Voir les offres', unsub: 'Ne plus recevoir d’offres', footer: (h, c) => `${h}, ${c}. Vous recevez ce message car vous avez une réservation chez nous.`,
    breakfast: 'Petit-déjeuner chaque matin', parking: 'Place de parking', upgrade: (r) => `Surclassement en ${r}`, late: (t) => `Départ tardif jusqu’à ${t}`,
    per_night: 'par nuit', total: 'Total', from: 'à partir de',
  },
  de: {
    hi: (n) => `Guten Tag ${n},`, conf_s: (h) => `Ihr Aufenthalt im ${h} ist bestätigt`, conf_b: (a, d, r) => `Wir freuen uns, Sie vom ${a} bis ${d} im ${r} zu begrüßen.`,
    offer_s: (h) => `Machen Sie Ihren Aufenthalt im ${h} noch schöner`, offer_b: 'Für Ihre Daten sind noch einige Extras frei. Buchen Sie jetzt, dann ist bei Ihrer Ankunft alles bereit:',
    rem_s: 'Ihre Extras warten auf Sie', rem_b: 'Ihre Anreise steht bevor. Diese Extras sind noch frei:',
    late_s: 'Morgen etwas länger bleiben?', late_b: 'Checken Sie morgen später aus und genießen Sie einen ruhigen Vormittag:',
    receipt_s: 'Ihre Extras sind gebucht', receipt_b: 'Vielen Dank. Wir haben diese Extras zu Ihrem Aufenthalt hinzugefügt; sie erscheinen beim Check-out auf Ihrer Rechnung:',
    cta: 'Angebote ansehen', unsub: 'Keine Angebote mehr', footer: (h, c) => `${h}, ${c}. Sie erhalten diese E-Mail, weil Sie bei uns gebucht haben.`,
    breakfast: 'Frühstück jeden Morgen', parking: 'Parkplatz', upgrade: (r) => `Upgrade auf ${r}`, late: (t) => `Später Check-out bis ${t}`,
    per_night: 'pro Nacht', total: 'Gesamt', from: 'ab',
  },
};

export function money(v, cur = 'EUR', lang = 'en') {
  return new Intl.NumberFormat({ en: 'en-GB', pt: 'pt-PT', fr: 'fr-FR', de: 'de-DE' }[lang] || 'en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);
}

export function fmtDate(date, lang = 'en') {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat({ en: 'en-GB', pt: 'pt-PT', fr: 'fr-FR', de: 'de-DE' }[lang] || 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function offerLine(d, hotel, lang) {
  const s = STRINGS[lang] || STRINGS.en, cur = hotel.currency;
  const roomName = (code) => hotel.roomTypes.find((t) => t.code === code).name[lang] || hotel.roomTypes.find((t) => t.code === code).name.en;
  if (d.kind === 'breakfast') return { title: s.breakfast, price: `${money(d.perNight, cur, lang)} ${s.per_night}` };
  if (d.kind === 'parking') return { title: s.parking, price: `${money(d.perNight, cur, lang)} ${s.per_night}` };
  if (d.kind === 'upgrade') return { title: s.upgrade(roomName(d.to)), price: `${money(d.perNight, cur, lang)} ${s.per_night}` };
  if (d.kind === 'late') { const o = d.options.find((x) => x.ok); return { title: s.late(o.until), price: money(o.price, cur, lang) }; }
  return { title: d.kind, price: '' };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Builds a message. links: { offer, unsubscribe } absolute URLs. */
export function buildEmail({ type, res, hotel, decisions = [], items = [], links = {}, from = 'stay@meridiana.example' }) {
  const lang = STRINGS[res.guest.language] ? res.guest.language : 'en';
  const s = STRINGS[lang];
  const roomName = (code) => hotel.roomTypes.find((t) => t.code === code).name[lang];
  const promotional = ['offer', 'reminder', 'late'].includes(type);
  let subject, intro, lines = [];
  if (type === 'confirmation') { subject = s.conf_s(hotel.name); intro = s.conf_b(fmtDate(res.arrival, lang), fmtDate(res.departure, lang), roomName(res.roomType)); }
  else if (type === 'offer') { subject = s.offer_s(hotel.name); intro = s.offer_b; lines = decisions.filter((d) => d.ok).slice(0, 3).map((d) => offerLine(d, hotel, lang)); }
  else if (type === 'reminder') { subject = s.rem_s; intro = s.rem_b; lines = decisions.filter((d) => d.ok).slice(0, 3).map((d) => offerLine(d, hotel, lang)); }
  else if (type === 'late') { subject = s.late_s; intro = s.late_b; lines = decisions.filter((d) => d.ok && d.kind === 'late').map((d) => offerLine(d, hotel, lang)); }
  else if (type === 'receipt') { subject = s.receipt_s; intro = s.receipt_b; lines = items.filter((i) => i.ok).map((i) => ({ title: i.label, price: money(i.total, hotel.currency, lang) })); }
  const headers = { From: `${hotel.name} <${from}>`, To: res.guest.email, Subject: subject, 'Content-Language': lang };
  if (promotional && links.unsubscribe) {
    headers['List-Unsubscribe'] = `<${links.unsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const text = [s.hi(res.guest.first), '', intro, '', ...lines.map((l) => `- ${l.title}: ${l.price}`), '', promotional && links.offer ? `${s.cta}: ${links.offer}` : '', '', s.footer(hotel.name, hotel.city), promotional && links.unsubscribe ? `${s.unsub}: ${links.unsubscribe}` : ''].filter((x) => x !== false).join('\n');
  const html = `<p>${esc(s.hi(res.guest.first))}</p><p>${esc(intro)}</p>${lines.length ? `<ul>${lines.map((l) => `<li><b>${esc(l.title)}</b> ${esc(l.price)}</li>`).join('')}</ul>` : ''}${promotional && links.offer ? `<p><a href="${esc(links.offer)}">${esc(s.cta)}</a></p>` : ''}<p><small>${esc(s.footer(hotel.name, hotel.city))}${promotional && links.unsubscribe ? ` <a href="${esc(links.unsubscribe)}">${esc(s.unsub)}</a>` : ''}</small></p>`;
  return { type, lang, promotional, headers, subject, intro, lines, text, html, links };
}

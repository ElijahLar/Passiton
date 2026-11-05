// Pure rules shared by the UI and local tests. Database functions remain authoritative.
(function (root) {
  const activeStatuses = new Set(['pending_seller', 'countered', 'accepted_awaiting_payment']);
  const minOffer = price => Math.ceil(Number(price) / 2);
  const isValidOffer = (offer, price) => Number.isInteger(offer) && offer >= minOffer(price) && offer < price;
  const isActive = status => activeStatuses.has(status);
  const expired = (date, now = Date.now()) => !!date && Date.parse(date) <= now;
  const formatRemaining = (date, now = Date.now()) => {
    if (!date || expired(date, now)) return 'Tiden har gått ut';
    const minutes = Math.ceil((Date.parse(date) - now) / 60000);
    if (minutes < 60) return `${minutes} min kvar`;
    const hours = Math.floor(minutes / 60);
    return `${hours} tim ${minutes % 60} min kvar`;
  };
  const rules = {minOffer, isValidOffer, isActive, expired, formatRemaining};
  root.passitonOfferRules = rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);

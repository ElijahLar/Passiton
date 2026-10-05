export const state = {
  purchases: JSON.parse(localStorage.getItem('passiton-purchases') || '[]'),
  listings: JSON.parse(localStorage.getItem('passiton-listings') || '[]'),
  selectedId: 1,
  search: '',
  category: 'all',
  minDiscount: 0,
  sort: 'popular'
};

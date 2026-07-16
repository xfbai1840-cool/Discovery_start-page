const filters = [...document.querySelectorAll('.filter')];
const cards = [...document.querySelectorAll('.tool-card')];
const search = document.querySelector('#toolSearch');
const empty = document.querySelector('#emptyState');
let category = 'all';

function applyFilters() {
  const query = search.value.trim().toLowerCase();
  let visible = 0;
  cards.forEach(card => {
    const categories = card.dataset.category.split(' ');
    const haystack = `${card.dataset.search} ${card.textContent}`.toLowerCase();
    const show = (category === 'all' || categories.includes(category)) && (!query || haystack.includes(query));
    card.hidden = !show;
    if (show) visible += 1;
  });
  empty.hidden = visible !== 0;
}

filters.forEach(button => button.addEventListener('click', () => {
  filters.forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  category = button.dataset.filter;
  applyFilters();
}));
search.addEventListener('input', applyFilters);

function updateTime() {
  const target = document.querySelector('#localTime');
  target.textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date());
}
updateTime();
setInterval(updateTime, 30000);

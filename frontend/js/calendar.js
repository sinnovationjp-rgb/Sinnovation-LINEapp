// ダミーの空き状況データ（{date, available}形式）。Phase 3でGASの実APIに置き換え
function getDummyAvailability() {
  const today = new Date();
  const data = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    data.push({ date: dateStr, available: i % 3 !== 0 });
  }
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  const calendarEl = document.getElementById('calendar');
  const availability = getDummyAvailability();

  const events = availability.map(({ date, available }) => ({
    start: date,
    display: 'background',
    color: available ? '#8fd3a0' : '#e58f8f'
  }));

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ja',
    height: 'auto',
    events
  });
  calendar.render();
});

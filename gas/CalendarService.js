var CalendarService = (function () {
  function getCalendarId_() {
    return PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  }

  function createEvent(reservation) {
    try {
      const calendar = CalendarApp.getCalendarById(getCalendarId_());
      if (!calendar) {
        throw new Error('CALENDAR_IDのカレンダーが見つからないかアクセス権がありません');
      }
      const start = new Date(reservation.datetime);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const drinkLabel = reservation.drink ? `／飲み放題${reservation.drink}` : '';
      const title = `[${reservation.space || ''}] ${reservation.name || ''}様（${reservation.headcount || ''}名${drinkLabel}）`;
      return calendar.createEvent(title, start, end, { description: reservation.note || '' });
    } catch (err) {
      console.error('CalendarService.createEvent failed', err);
      throw err;
    }
  }

  return {
    createEvent: createEvent
  };
})();

var CalendarService = (function () {
  function getCalendarId_() {
    return PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  }

  function getAvailability(daysAhead) {
    const result = [];
    let calendar;
    try {
      calendar = CalendarApp.getCalendarById(getCalendarId_());
    } catch (err) {
      console.error('CalendarService.getAvailability: カレンダー取得に失敗しました', err);
      calendar = null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < daysAhead; i++) {
      const dayStart = new Date(today);
      dayStart.setDate(today.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);

      let available = false;
      if (calendar) {
        try {
          available = calendar.getEvents(dayStart, dayEnd).length === 0;
        } catch (err) {
          console.error('CalendarService.getAvailability: イベント取得に失敗しました', err);
        }
      }

      result.push({
        date: Utilities.formatDate(dayStart, 'Asia/Tokyo', 'yyyy-MM-dd'),
        available: available
      });
    }
    return result;
  }

  function createEvent(reservation) {
    try {
      const calendar = CalendarApp.getCalendarById(getCalendarId_());
      const start = new Date(reservation.datetime);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const title = `${reservation.plan || ''} - ${reservation.name || ''}様（${reservation.headcount || ''}名）`;
      return calendar.createEvent(title, start, end, { description: reservation.note || '' });
    } catch (err) {
      console.error('CalendarService.createEvent failed', err);
      throw err;
    }
  }

  return {
    getAvailability: getAvailability,
    createEvent: createEvent
  };
})();

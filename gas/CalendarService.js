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

  return {
    getAvailability: getAvailability
  };
})();

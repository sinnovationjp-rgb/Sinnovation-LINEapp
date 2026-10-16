var CalendarService = (function () {
  function getCalendarId_() {
    return PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  }

  // 呼び出し元(Code.js)がtry/catchして予約ID付きでログを残すため、ここでは二重にログしない
  function createEvent(reservation) {
    const calendar = CalendarApp.getCalendarById(getCalendarId_());
    if (!calendar) {
      throw new Error('CALENDAR_IDのカレンダーが見つからないかアクセス権がありません');
    }
    const start = new Date(reservation.datetime);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return calendar.createEvent(buildTitle_(reservation), start, end, { description: reservation.note || '' });
  }

  function buildTitle_(reservation) {
    const drinkLabel = reservation.drink ? `／飲み放題${reservation.drink}` : '';
    return `[${reservation.space || ''}] ${reservation.name || ''}様（${reservation.headcount || ''}名${drinkLabel}）`;
  }

  // 人数変更など、確定済み予約の内容が変わったときに予定のタイトルを更新する
  function updateEventTitle(eventId, reservation) {
    if (!eventId) return;
    const calendar = CalendarApp.getCalendarById(getCalendarId_());
    if (!calendar) {
      throw new Error('CALENDAR_IDのカレンダーが見つからないかアクセス権がありません');
    }
    const event = calendar.getEventById(eventId);
    if (event) {
      event.setTitle(buildTitle_(reservation));
    }
  }

  // Googleの「日本の祝日」カレンダーから、指定期間の祝日を { 'yyyy-MM-dd': '祝日名' } で返す。
  // 2024年頃から節分・ひな祭り・クリスマスなど祝日でない行事も入るようになったため、
  // 説明欄が「祝日」で始まるもの（国民の祝日・振替休日）だけを祝日として扱う
  const HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

  function getJapaneseHolidays(startDate, endDate) {
    const startStr = Utilities.formatDate(startDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    const endStr = Utilities.formatDate(endDate, 'Asia/Tokyo', 'yyyy-MM-dd');
    const cache = CacheService.getScriptCache();
    const cacheKey = `JP_HOLIDAYS_${startStr}_${endStr}`;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const calendar = CalendarApp.getCalendarById(HOLIDAY_CALENDAR_ID);
    if (!calendar) {
      throw new Error('「日本の祝日」カレンダーを取得できませんでした');
    }
    const holidays = {};
    calendar.getEvents(startDate, endDate).forEach((event) => {
      if (String(event.getDescription() || '').trim().indexOf('祝日') !== 0) return;
      const dateStr = Utilities.formatDate(event.getAllDayStartDate(), 'Asia/Tokyo', 'yyyy-MM-dd');
      holidays[dateStr] = event.getTitle();
    });
    cache.put(cacheKey, JSON.stringify(holidays), 6 * 60 * 60);
    return holidays;
  }

  function deleteEvent(eventId) {
    if (!eventId) return;
    const calendar = CalendarApp.getCalendarById(getCalendarId_());
    if (!calendar) {
      throw new Error('CALENDAR_IDのカレンダーが見つからないかアクセス権がありません');
    }
    const event = calendar.getEventById(eventId);
    if (event) {
      event.deleteEvent();
    }
  }

  return {
    createEvent: createEvent,
    deleteEvent: deleteEvent,
    updateEventTitle: updateEventTitle,
    getJapaneseHolidays: getJapaneseHolidays
  };
})();

function sendReminders() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = Utilities.formatDate(tomorrow, 'Asia/Tokyo', 'yyyy-MM-dd');

    const reservations = SheetService.getConfirmedReservationsForDate(dateStr);
    reservations.forEach((reservation) => {
      const message = buildReminderMessage_(reservation);
      const userId = reservation['LINE UserId'];
      if (userId) {
        LineService.pushMessage(userId, message);
      }
      NotifyService.send(`【リマインド】明日のご予約\n${message}`);
    });
  } catch (err) {
    console.error('sendReminders failed', err);
  }
}

function buildReminderMessage_(reservation) {
  return [
    `日時: ${reservation['予約日時'] || ''}`,
    `人数: ${reservation['人数'] || ''}`,
    `プラン: ${reservation['プラン'] || ''}`,
    `氏名: ${reservation['氏名'] || ''}`
  ].join('\n');
}

// GASエディタで初回のみ手動実行してリマインド用の日次トリガーを登録する
function createDailyTrigger() {
  const alreadyRegistered = ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction() === 'sendReminders'
  );
  if (alreadyRegistered) {
    console.warn('createDailyTrigger: 既にトリガーが登録されています');
    return;
  }
  ScriptApp.newTrigger('sendReminders')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

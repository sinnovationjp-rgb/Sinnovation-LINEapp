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
        const lineOk = LineService.pushMessage(userId, message);
        if (!lineOk) {
          NotifyService.send(`⚠️ 前日リマインドのLINE送信に失敗しました（予約ID ${reservation['ID']}）`);
        }
      }

      sendEmail_(
        reservation['メールアドレス'],
        '【oO SPACE】明日のご予約について',
        `明日のご予約について、内容をご確認ください。\n\n${message}\n\nご不明点がございましたら店舗までお問い合わせください。`
      );

      NotifyService.send(`【リマインド】明日のご予約\n${message}`);
    });
  } catch (err) {
    console.error('sendReminders failed', err);
  }
}

function buildReminderMessage_(reservation) {
  return [
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `飲み放題: ${reservation['飲み放題'] || ''}`,
    `氏名: ${reservation['氏名（カタカナ）'] || ''}`
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

// 古い確定済み/キャンセル済み予約データを「予約一覧_archive」シートへ退避し、
// メインシートの行数肥大化によるパフォーマンス低下を防ぐ
function archiveOldReservations() {
  SheetService.archiveOldReservations();
}

// GASエディタで初回のみ手動実行してアーカイブ用の月次トリガーを登録する
function createArchiveTrigger() {
  const alreadyRegistered = ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction() === 'archiveOldReservations'
  );
  if (alreadyRegistered) {
    console.warn('createArchiveTrigger: 既にトリガーが登録されています');
    return;
  }
  ScriptApp.newTrigger('archiveOldReservations')
    .timeBased()
    .onMonthDay(1)
    .atHour(4)
    .create();
}

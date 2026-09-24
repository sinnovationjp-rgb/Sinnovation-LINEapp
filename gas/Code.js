function doGet(e) {
  if (e.parameter && e.parameter.page === 'approval' && e.parameter.id) {
    return renderApprovalPage_(e.parameter.id);
  }
  if (e.parameter && e.parameter.page === 'admin') {
    return renderAdminPage_();
  }
  const availability = SheetService.getAvailability(30);
  return jsonResponse_(availability);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    console.error('doPost: リクエストのパースに失敗しました', err);
    return jsonResponse_({ success: false, error: 'invalid request' });
  }

  try {
    const id = SheetService.addProvisionalReservation(data);
    const approvalUrl = ScriptApp.getService().getUrl() + '?page=approval&id=' + id;
    NotifyService.send(buildProvisionalMessage_(id, data, approvalUrl));
    return jsonResponse_({ success: true, id: id });
  } catch (err) {
    console.error('doPost: 仮予約処理に失敗しました', err);
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function approveReservation(id, editedData) {
  try {
    const reservation = SheetService.getReservationById(id);
    if (!reservation) {
      throw new Error(`予約ID ${id} が見つかりません`);
    }

    const confirmed = Object.assign({}, reservation, editedData || {});

    SheetService.updateReservation(id, {
      'ステータス': '確定',
      '予約日時': confirmed['予約日時'],
      '人数': confirmed['人数'],
      'スペース': confirmed['スペース'],
      '飲み放題': confirmed['飲み放題'],
      'ご利用履歴': confirmed['ご利用履歴'],
      '氏名（カタカナ）': confirmed['氏名（カタカナ）'],
      '電話番号': confirmed['電話番号'],
      'メールアドレス': confirmed['メールアドレス'],
      '備考': confirmed['備考']
    });

    try {
      const event = CalendarService.createEvent({
        datetime: confirmed['予約日時'],
        headcount: confirmed['人数'],
        space: confirmed['スペース'],
        drink: confirmed['飲み放題'],
        name: confirmed['氏名（カタカナ）'],
        note: confirmed['備考']
      });
      SheetService.updateReservation(id, { 'カレンダーイベントID': event.getId() });
    } catch (calendarErr) {
      console.error(`approveReservation: カレンダー登録に失敗しました（予約ID ${id}）。スプレッドシートの確定・通知は続行します`, calendarErr);
    }

    NotifyService.send(buildConfirmedMessage_(confirmed));

    const userId = confirmed['LINE UserId'];
    if (userId) {
      LineService.pushConfirmation(userId, confirmed);
    } else {
      console.warn(`approveReservation: LINE UserIdが空のため確定通知を送信できません（予約ID ${id}）`);
    }

    return { success: true };
  } catch (err) {
    console.error('approveReservation failed', err);
    return { success: false, error: String(err) };
  }
}

function renderApprovalPage_(id) {
  const reservation = SheetService.getReservationById(id);
  const template = HtmlService.createTemplateFromFile('ApprovalPage');
  template.reservationId = id;
  template.reservation = reservation;
  return template.evaluate().setTitle('予約承認');
}

// 管理者アカウントのみアクセス許可（スクリプトプロパティADMIN_EMAILSに登録されたメールアドレスの一覧と照合）
function isAuthorizedAdmin_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return false;
  const allowList = (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowList.indexOf(email) !== -1;
}

function renderAdminPage_() {
  if (!isAuthorizedAdmin_()) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;text-align:center;padding:80px 20px;color:#211d17;">' +
      '<h1>アクセス権がありません</h1>' +
      '<p>この画面は管理者アカウントでログインした場合のみ利用できます。</p>' +
      '</div>'
    ).setTitle('アクセス権がありません');
  }
  const template = HtmlService.createTemplateFromFile('AdminPage');
  template.reservations = SheetService.getAllReservations();
  return template.evaluate().setTitle('予約管理');
}

function cancelReservation(id) {
  try {
    if (!isAuthorizedAdmin_()) {
      throw new Error('アクセス権がありません');
    }
    const reservation = SheetService.getReservationById(id);
    if (!reservation) {
      throw new Error(`予約ID ${id} が見つかりません`);
    }
    const wasConfirmed = reservation['ステータス'] === '確定';

    SheetService.updateReservation(id, { 'ステータス': 'キャンセル' });

    if (wasConfirmed && reservation['カレンダーイベントID']) {
      try {
        CalendarService.deleteEvent(reservation['カレンダーイベントID']);
      } catch (calendarErr) {
        console.error(`cancelReservation: カレンダーの予定削除に失敗しました（予約ID ${id}）`, calendarErr);
      }
    }

    NotifyService.send(buildCancelledMessage_(reservation, wasConfirmed));

    const userId = reservation['LINE UserId'];
    if (userId) {
      LineService.pushCancellation(userId, reservation, wasConfirmed);
    } else {
      console.warn(`cancelReservation: LINE UserIdが空のためキャンセル通知を送信できません（予約ID ${id}）`);
    }

    return { success: true };
  } catch (err) {
    console.error('cancelReservation failed', err);
    return { success: false, error: String(err) };
  }
}

// 予約日時をお客様・スタッフ向けに分かりやすい表記に変換する（Dateオブジェクト・ISO文字列どちらにも対応）
function formatDateTimeForDisplay_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日(${dows[date.getDay()]}) ${hh}:${mi}`;
}

function buildProvisionalMessage_(id, data, approvalUrl) {
  return [
    '新規予約リクエストがありました',
    `日時: ${data.datetime ? formatDateTimeForDisplay_(data.datetime) : '未入力'}`,
    `人数: ${data.headcount ? data.headcount + '名' : '未入力'}`,
    `スペース: ${data.space || '未入力'}`,
    `飲み放題: ${data.drink || '未入力'}`,
    `ご利用履歴: ${data.usageHistory || '未入力'}`,
    `氏名: ${data.name || '未入力'}`,
    `電話番号: ${data.phone || '未入力'}`,
    `メールアドレス: ${data.email || 'なし'}`,
    `備考: ${data.note || 'なし'}`,
    `承認画面: ${approvalUrl}`
  ].join('\n');
}

function buildConfirmedMessage_(reservation) {
  return [
    '予約が確定しました',
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `飲み放題: ${reservation['飲み放題'] || ''}`,
    `氏名: ${reservation['氏名（カタカナ）'] || ''}`
  ].join('\n');
}

function buildCancelledMessage_(reservation, wasConfirmed) {
  return [
    wasConfirmed ? '確定済みの予約がキャンセルされました' : '仮予約が却下されました',
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `氏名: ${reservation['氏名（カタカナ）'] || ''}`
  ].join('\n');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// HtmlServiceテンプレート内でJSONをscriptタグに安全に埋め込むためのヘルパー
function toSafeJson_(obj) {
  return JSON.stringify(obj === undefined ? null : obj).replace(/</g, '\\u003c');
}

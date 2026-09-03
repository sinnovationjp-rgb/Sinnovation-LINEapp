function doGet(e) {
  if (e.parameter && e.parameter.page === 'approval' && e.parameter.id) {
    return renderApprovalPage_(e.parameter.id);
  }
  const availability = CalendarService.getAvailability(30);
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
      'プラン': confirmed['プラン'],
      '氏名': confirmed['氏名'],
      '電話番号': confirmed['電話番号'],
      '備考': confirmed['備考']
    });

    CalendarService.createEvent({
      datetime: confirmed['予約日時'],
      headcount: confirmed['人数'],
      plan: confirmed['プラン'],
      name: confirmed['氏名'],
      note: confirmed['備考']
    });

    NotifyService.send(buildConfirmedMessage_(confirmed));

    const userId = confirmed['LINE UserId'];
    if (userId) {
      LineService.pushConfirmation(userId, confirmed);
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

function buildProvisionalMessage_(id, data, approvalUrl) {
  return [
    '新規予約リクエストがありました',
    `日時: ${data.datetime || '未入力'}`,
    `人数: ${data.headcount || '未入力'}`,
    `プラン: ${data.plan || '未入力'}`,
    `氏名: ${data.name || '未入力'}`,
    `電話番号: ${data.phone || '未入力'}`,
    `備考: ${data.note || 'なし'}`,
    `承認画面: ${approvalUrl}`
  ].join('\n');
}

function buildConfirmedMessage_(reservation) {
  return [
    '予約が確定しました',
    `日時: ${reservation['予約日時'] || ''}`,
    `人数: ${reservation['人数'] || ''}`,
    `プラン: ${reservation['プラン'] || ''}`,
    `氏名: ${reservation['氏名'] || ''}`
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

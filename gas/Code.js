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

function renderApprovalPage_(id) {
  const template = HtmlService.createTemplateFromFile('ApprovalPage');
  template.reservationId = id;
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

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

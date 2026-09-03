var LineService = (function () {
  function getAccessToken_() {
    return PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  }

  function pushMessage(userId, text) {
    const token = getAccessToken_();
    if (!token) {
      console.error('LineService.pushMessage: LINE_CHANNEL_ACCESS_TOKENが未設定です');
      return;
    }
    if (!userId) {
      console.error('LineService.pushMessage: userIdが指定されていません');
      return;
    }
    try {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text: text }]
        }),
        muteHttpExceptions: true
      });
    } catch (err) {
      console.error('LineService.pushMessage failed', err);
    }
  }

  function pushConfirmation(userId, reservation) {
    const text = [
      'ご予約が確定しました',
      `日時: ${reservation['予約日時'] || ''}`,
      `人数: ${reservation['人数'] || ''}`,
      `プラン: ${reservation['プラン'] || ''}`
    ].join('\n');
    pushMessage(userId, text);
  }

  return {
    pushMessage: pushMessage,
    pushConfirmation: pushConfirmation
  };
})();

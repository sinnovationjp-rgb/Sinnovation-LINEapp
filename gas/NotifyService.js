var NotifyService = (function () {
  function getWebhookUrl_() {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty('DISCORD_WEBHOOK_URL') || props.getProperty('SLACK_WEBHOOK_URL');
  }

  function buildPayload_(url, message) {
    if (url.indexOf('discord.com') !== -1) {
      // allowed_mentions: [] で氏名・備考等に@everyone等が入力されてもメンションを発生させない
      return { content: message, allowed_mentions: { parse: [] } };
    }
    return { text: message };
  }

  // 1回だけ送信を試みる。成功ならtrue、失敗ならfalseを返す（例外は投げない）
  function attemptSend_(url, message) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(buildPayload_(url, message)),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        return true;
      }
      console.error(`NotifyService.send: Webhookがエラーを返しました (status=${code})`, response.getContentText());
      return false;
    } catch (err) {
      console.error('NotifyService.send failed', err);
      return false;
    }
  }

  // Discord/Slackへの送信が最終的に失敗した場合、ADMIN_EMAILSへフォールバックメールを送り、
  // 予約の見落としを防ぐ（設定されているスタッフ全員に送る）
  function notifyAdminsOfFailure_(message, reason) {
    try {
      const adminEmails = (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (adminEmails.length === 0) {
        console.error('NotifyService.notifyAdminsOfFailure_: ADMIN_EMAILSが未設定のためフォールバック通知を送れません');
        return;
      }
      adminEmails.forEach((email) => {
        MailApp.sendEmail({
          to: email,
          subject: '【oO SPACE】Discord通知の送信に失敗しました',
          body: [
            'Discord（またはSlack）への通知の送信に複数回試行しましたが失敗しました。',
            reason ? `理由: ${reason}` : '',
            '',
            '--- 本来送るはずだった内容 ---',
            message,
            '',
            '予約の見落としを防ぐため、スプレッドシートを直接ご確認ください。'
          ].filter((line) => line !== '').join('\n'),
          name: 'oO SPACE'
        });
      });
    } catch (err) {
      console.error('NotifyService.notifyAdminsOfFailure_ failed', err);
    }
  }

  // 一時的な通信エラーやDiscordのレート制限に備え、間隔を空けて最大3回まで再送する。
  // それでも失敗した場合はADMIN_EMAILSへフォールバックメールを送り、スタッフが気づけるようにする
  function send(message) {
    const url = getWebhookUrl_();
    if (!url) {
      console.error('NotifyService.send: Webhook URLが未設定です');
      notifyAdminsOfFailure_(message, 'Webhook URL（DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL）が未設定です');
      return;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attemptSend_(url, message)) {
        return;
      }
      if (attempt < maxAttempts) {
        Utilities.sleep(1000 * attempt); // 1秒、2秒と間隔を空けて再試行（レート制限・一時的な通信障害への対応）
      }
    }

    console.error(`NotifyService.send: ${maxAttempts}回再試行しましたが送信できませんでした`);
    notifyAdminsOfFailure_(message, `${maxAttempts}回再試行しましたが送信できませんでした`);
  }

  return {
    send: send
  };
})();

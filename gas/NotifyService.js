var NotifyService = (function () {
  function getWebhookUrl_() {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty('DISCORD_WEBHOOK_URL') || props.getProperty('SLACK_WEBHOOK_URL');
  }

  function buildPayload_(url, message) {
    if (url.indexOf('discord.com') !== -1) {
      return { content: message };
    }
    return { text: message };
  }

  function send(message) {
    const url = getWebhookUrl_();
    if (!url) {
      console.error('NotifyService.send: Webhook URLが未設定です');
      return;
    }
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(buildPayload_(url, message)),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        console.error(`NotifyService.send: Webhookがエラーを返しました (status=${code})`, response.getContentText());
      }
    } catch (err) {
      console.error('NotifyService.send failed', err);
    }
  }

  return {
    send: send
  };
})();

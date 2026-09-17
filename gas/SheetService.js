var SheetService = (function () {
  const SHEET_NAME = '予約一覧';
  const HEADERS = ['ID', 'ステータス', '予約日時', '人数', 'スペース', '飲み放題', 'ご利用履歴', '氏名（カタカナ）', '電話番号', 'メールアドレス', '備考', 'LINE UserId', '登録日時'];
  const DAILY_CAPACITY = 15; // 1日あたりの合計人数の上限（スペース合算、目安表示用）

  function getSheet_() {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    const ss = SpreadsheetApp.openById(spreadsheetId);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    } else {
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const headersMatch = HEADERS.length === currentHeaders.length &&
        HEADERS.every((h, i) => h === currentHeaders[i]);
      if (!headersMatch) {
        sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      }
    }
    return sheet;
  }

  function findRowById_(sheet, id) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === id) {
        return { rowIndex: i + 1, headers: values[0], row: values[i] };
      }
    }
    return null;
  }

  function rowToObject_(headers, row) {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  }

  // 先頭が=+-@のときスプレッドシート上で数式扱いされるのを防ぐ（外部入力を書き込む前に必ず通す）
  // また電話番号のように先頭が0の数字列は、数値扱いされると0が消えてしまうため合わせて保護する
  function sanitizeCell_(value) {
    if (typeof value !== 'string') return value;
    if (/^[=+\-@\t\r]/.test(value) || /^0\d/.test(value)) {
      return `'${value}`;
    }
    return value;
  }

  function addProvisionalReservation(data) {
    try {
      const sheet = getSheet_();
      const id = Utilities.getUuid();
      sheet.appendRow([
        id,
        '仮予約',
        sanitizeCell_(data.datetime || ''),
        sanitizeCell_(data.headcount || ''),
        sanitizeCell_(data.space || ''),
        sanitizeCell_(data.drink || ''),
        sanitizeCell_(data.usageHistory || ''),
        sanitizeCell_(data.name || ''),
        sanitizeCell_(data.phone || ''),
        sanitizeCell_(data.email || ''),
        sanitizeCell_(data.note || ''),
        sanitizeCell_(data.userId || ''),
        new Date()
      ]);
      return id;
    } catch (err) {
      console.error('SheetService.addProvisionalReservation failed', err);
      throw err;
    }
  }

  function getReservationById(id) {
    try {
      const sheet = getSheet_();
      const found = findRowById_(sheet, id);
      return found ? rowToObject_(found.headers, found.row) : null;
    } catch (err) {
      console.error('SheetService.getReservationById failed', err);
      throw err;
    }
  }

  function updateReservation(id, updates) {
    try {
      const sheet = getSheet_();
      const found = findRowById_(sheet, id);
      if (!found) {
        throw new Error(`予約ID ${id} が見つかりません`);
      }
      Object.keys(updates).forEach((key) => {
        const col = HEADERS.indexOf(key);
        if (col === -1) return;
        sheet.getRange(found.rowIndex, col + 1).setValue(sanitizeCell_(updates[key]));
      });
    } catch (err) {
      console.error('SheetService.updateReservation failed', err);
      throw err;
    }
  }

  function formatDateOnly_(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  function getConfirmedReservationsForDate(dateStr) {
    try {
      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const results = [];
      for (let i = 1; i < values.length; i++) {
        const obj = rowToObject_(headers, values[i]);
        if (obj['ステータス'] !== '確定') continue;
        if (formatDateOnly_(obj['予約日時']) === dateStr) {
          results.push(obj);
        }
      }
      return results;
    } catch (err) {
      console.error('SheetService.getConfirmedReservationsForDate failed', err);
      throw err;
    }
  }

  function getAvailability(daysAhead) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bookedHeadcount = {};
    try {
      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      for (let i = 1; i < values.length; i++) {
        const obj = rowToObject_(headers, values[i]);
        if (obj['ステータス'] !== '確定') continue;
        const dateStr = formatDateOnly_(obj['予約日時']);
        if (!dateStr) continue;
        const headcount = Number(obj['人数']) || 0;
        bookedHeadcount[dateStr] = (bookedHeadcount[dateStr] || 0) + headcount;
      }
    } catch (err) {
      console.error('SheetService.getAvailability: 予約データの取得に失敗しました', err);
    }

    const result = [];
    for (let i = 0; i < daysAhead; i++) {
      const day = new Date(today);
      day.setDate(today.getDate() + i);
      const dateStr = Utilities.formatDate(day, 'Asia/Tokyo', 'yyyy-MM-dd');
      const total = bookedHeadcount[dateStr] || 0;
      result.push({ date: dateStr, available: total < DAILY_CAPACITY });
    }
    return result;
  }

  function getAllReservations() {
    try {
      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const results = [];
      for (let i = 1; i < values.length; i++) {
        results.push(rowToObject_(headers, values[i]));
      }
      return results;
    } catch (err) {
      console.error('SheetService.getAllReservations failed', err);
      throw err;
    }
  }

  // 過去データ修正用: 電話番号列がスプレッドシートに数値として保存され先頭の0が消えている行を一括で文字列に戻す
  function fixPhoneNumberLeadingZeros() {
    try {
      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const col = headers.indexOf('電話番号');
      if (col === -1) {
        console.error('SheetService.fixPhoneNumberLeadingZeros: 電話番号列が見つかりません');
        return 0;
      }
      let fixedCount = 0;
      for (let i = 1; i < values.length; i++) {
        const value = values[i][col];
        if (typeof value === 'number') {
          sheet.getRange(i + 1, col + 1).setValue(`'0${value}`);
          fixedCount++;
        }
      }
      console.log(`SheetService.fixPhoneNumberLeadingZeros: ${fixedCount}件の電話番号を修正しました`);
      return fixedCount;
    } catch (err) {
      console.error('SheetService.fixPhoneNumberLeadingZeros failed', err);
      throw err;
    }
  }

  return {
    addProvisionalReservation: addProvisionalReservation,
    getReservationById: getReservationById,
    updateReservation: updateReservation,
    getConfirmedReservationsForDate: getConfirmedReservationsForDate,
    getAvailability: getAvailability,
    getAllReservations: getAllReservations,
    fixPhoneNumberLeadingZeros: fixPhoneNumberLeadingZeros
  };
})();

// GASエディタで一度だけ手動実行して、既存データの電話番号の先頭0が消えている問題を一括修正する
function fixPhoneNumberLeadingZeros() {
  SheetService.fixPhoneNumberLeadingZeros();
}

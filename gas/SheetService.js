var SheetService = (function () {
  const SHEET_NAME = '予約一覧';
  const HEADERS = ['ID', 'ステータス', '予約日時', '人数', 'プラン', '氏名', '電話番号', '備考', 'LINE UserId', '登録日時'];

  function getSheet_() {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    const ss = SpreadsheetApp.openById(spreadsheetId);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
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

  function addProvisionalReservation(data) {
    try {
      const sheet = getSheet_();
      const id = Utilities.getUuid();
      sheet.appendRow([
        id,
        '仮予約',
        data.datetime || '',
        data.headcount || '',
        data.plan || '',
        data.name || '',
        data.phone || '',
        data.note || '',
        data.userId || '',
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
        sheet.getRange(found.rowIndex, col + 1).setValue(updates[key]);
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

  return {
    addProvisionalReservation: addProvisionalReservation,
    getReservationById: getReservationById,
    updateReservation: updateReservation,
    getConfirmedReservationsForDate: getConfirmedReservationsForDate
  };
})();

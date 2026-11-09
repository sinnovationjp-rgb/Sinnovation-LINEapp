# oO SPACE 予約システム 開発者向け仕様書

このシステムを引き継ぐ開発者が、全体の仕組み・データの流れ・コードの配置・運用上の注意点を一通り把握するための資料です。
ルールの要点は `CLAUDE.md` にもまとまっています。食い違いがあった場合は**コードが正**なので、気付いたらこの資料も直してください。

- 最終更新: 2026-11-09（`main` の e4c9273 時点のコードをもとに作成）
- 対象: 「oO SPACE Niigata」（LINE公式アカウント `@186lmmed`）のスペース予約

---

## 目次

1. [システム概要](#1-システム概要)
2. [全体構成](#2-全体構成)
3. [業務フローと予約ステータス](#3-業務フローと予約ステータス)
4. [ディレクトリ構成とファイルの役割](#4-ディレクトリ構成とファイルの役割)
5. [データモデル（スプレッドシート）](#5-データモデルスプレッドシート)
6. [GAS Webアプリのインターフェース](#6-gas-webアプリのインターフェース)
7. [業務ルール（予約受付の条件）](#7-業務ルール予約受付の条件)
8. [フロントエンド（LIFF予約フォーム）](#8-フロントエンドliff予約フォーム)
9. [スタッフ向け画面（承認画面・管理者画面）](#9-スタッフ向け画面承認画面管理者画面)
10. [認証・権限](#10-認証権限)
11. [通知](#11-通知)
12. [外部サービス連携](#12-外部サービス連携)
13. [定期実行（トリガー）](#13-定期実行トリガー)
14. [セキュリティ設計](#14-セキュリティ設計)
15. [設定値（スクリプトプロパティ・定数）](#15-設定値スクリプトプロパティ定数)
16. [開発・デプロイ手順](#16-開発デプロイ手順)
17. [保守・診断用の関数](#17-保守診断用の関数)
18. [既知の制約・注意点](#18-既知の制約注意点)
19. [関連ドキュメント](#19-関連ドキュメント)

---

## 1. システム概要

お客様がLINEから予約を申し込み、スタッフが内容を確認して確定する、**仮予約 → スタッフ承認 → 確定** の2段階方式の予約システムです。

| 誰が | 何をするか | 使う画面 |
|---|---|---|
| お客様 | LINEのリッチメニューから予約フォームを開き、日時・人数・スペースなどを入力して申し込む | LIFF予約フォーム（GitHub Pages） |
| スタッフ | Discordに届いた通知のリンクを開き、内容を確認・修正して承認する | 承認画面（GAS） |
| スタッフ | 予約の一覧・検索、却下・キャンセル、人数変更、電話予約などの代理登録、ユーザー管理 | 管理者画面（GAS） |
| システム | 確定時にGoogleカレンダーへ登録、お客様にLINE/メールで通知、前日にリマインド | GASの処理・トリガー |

**設計方針**: すべて無料枠のサービスで組んでいます（GitHub Pages / Google Apps Script / Googleスプレッドシート / Googleカレンダー / Discord Webhook / LINE Messaging API）。サーバーやデータベースを別に用意する必要はありません。

---

## 2. 全体構成

```
┌──────────────────────┐   fetch GET（空き状況JSON）
│ お客様のLINEアプリ    │ ─────────────────────────────┐
│  └ LIFF予約フォーム    │   fetch POST（予約データ）     │
│    (GitHub Pages)    │ ─────────────────────────────┤
└──────────────────────┘                              ▼
                                       ┌─────────────────────────────┐
┌──────────────────────┐ google.script │ Google Apps Script Webアプリ │
│ スタッフのブラウザ     │ ────.run────▶ │  doGet / doPost              │
│  ├ 承認画面           │ ◀──HTML────── │  Code.js ほか                │
│  └ 管理者画面         │               └──────┬───────┬───────┬──────┘
└──────────────────────┘                      │       │       │
                                              ▼       ▼       ▼
                         Googleスプレッドシート  Googleカレンダー  外部通知
                         （予約台帳＝DB）       （確定予約の記録   ├ Discord Webhook（スタッフ向け）
                                               ＋日本の祝日）     ├ LINE Messaging API（お客様向け）
                                                                 └ MailApp（お客様・管理者向け）
```

| レイヤー | 技術 | 補足 |
|---|---|---|
| フロントエンド | 素のHTML/CSS/JS（ビルドなし）＋ LIFF SDK v2 | GitHub Pagesで公開。LIFFはHTTPS必須 |
| バックエンド | Google Apps Script（V8ランタイム） | Webアプリとして1つのURLで公開（`doGet`/`doPost`） |
| DB | Googleスプレッドシート | シート「予約一覧」が台帳、古いデータは「予約一覧_archive」 |
| カレンダー | Google Calendar（`CalendarApp`） | 確定予約の記録先。空き状況の判定には**使わない** |
| 通知 | Discord（またはSlack）Webhook / LINE Messaging API / MailApp | |

GASプロジェクトの設定（`gas/appsscript.json`）:

```json
{
  "timeZone": "Asia/Tokyo",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "runtimeVersion": "V8"
}
```

- `executeAs: USER_DEPLOYING`（自分として実行）: すべての処理がスクリプト所有者の権限で動く。スプレッドシートやカレンダーは所有者がアクセスできれば良い
- `access: ANYONE_ANONYMOUS`（全員・匿名含む）: LIFFからの`fetch`や社外スタッフのアクセスのために必要。そのぶんセキュリティ上の注意がある（[14章](#14-セキュリティ設計)）

---

## 3. 業務フローと予約ステータス

### 3.1 ステータス

予約のステータスは3つです（シートの「ステータス」列の文字列）。

```
            お客様が申し込む / 管理画面で「仮予約」として追加
                         │
                         ▼
                    ┌─────────┐   却下（管理画面）
                    │ 仮予約   │ ───────────────────┐
                    └────┬────┘                     │
       承認（承認画面 /   │                          ▼
       管理画面）        ▼                     ┌──────────┐
                    ┌─────────┐  キャンセル     │ キャンセル │
 管理画面で「確定」 ─▶│  確定    │ ────────────▶ └──────────┘
 として追加          └─────────┘  （管理画面）
```

「却下」と「キャンセル」は、どちらもサーバー側では同じ `cancelReservation()` で、ステータスは「キャンセル」になります。元が仮予約か確定かで、通知の文面とカレンダー削除の有無が変わります。

### 3.2 各操作で起きること

| 操作 | 関数 | シート | カレンダー | Discord | LINE（UserIdあり） | メール（アドレスあり） |
|---|---|---|---|---|---|---|
| お客様が申し込む | `doPost` | 行を追加（仮予約） | — | 新規予約通知＋承認リンク | 仮予約受付 | 仮予約受付 |
| 承認する | `approveReservation` | 確定に更新（編集内容も反映） | 予定を作成し、IDを保存 | 確定報告 | 確定通知 | 確定通知 |
| 却下する（元が仮予約） | `cancelReservation` | キャンセルに更新 | — | 却下報告 | お断り | — |
| キャンセルする（元が確定） | `cancelReservation` | キャンセルに更新 | 予定を削除 | キャンセル報告 | キャンセル通知 | — |
| 人数を変更する | `updateReservationHeadcount` | 人数を更新 | 確定済みなら予定タイトルを更新 | 「○名 → ○名」 | — | — |
| 管理画面から追加（確定） | `createReservationByAdmin` | 行を追加 → 承認処理 | 予定を作成 | 確定報告 | —（UserIdなし） | 確定通知 |
| 管理画面から追加（仮予約） | `createReservationByAdmin` | 行を追加（仮予約） | — | 【管理画面から追加】＋承認リンク | — | —（※） |
| 前日リマインド | `sendReminders`（毎朝9時） | — | — | リマインド | リマインド | リマインド |

※ 仮予約受付メールの文面が「担当者よりLINEにてご連絡いたします」なので、LINE連携のない代理登録では送りません。

**二重実行の防止**: 承認済みの予約をもう一度承認したり、キャンセル済みの予約をもう一度キャンセルしたりした場合（連打・再読み込み・リンクの二重クリックなど）は、何もせずに成功を返します。カレンダーの二重登録や通知の二重送信は起きません。

**部分的な失敗の扱い**: カレンダー登録・削除、LINE送信、メール送信のどれかが失敗しても**予約処理そのものは続行**し、Discordに「⚠️ 〜に失敗しました（予約ID …）」と警告を出します。スタッフが手動で対応する前提です。

---

## 4. ディレクトリ構成とファイルの役割

```
Sinnovation-LINEapp/
├── frontend/                ← GitHub Pagesで公開（mainブランチ直結）
│   ├── index.html           トップ画面（LIFFエンドポイント）。「新規予約をする」ボタン
│   ├── reserve.html         予約フォーム（5ステップ）
│   ├── admin.html           GASの管理者画面（?page=admin）へ転送するだけのページ
│   ├── css/style.css        共通スタイル
│   ├── img/                 店舗写真
│   └── js/
│       ├── config.js        GAS_ENDPOINT_URL（GAS WebアプリのURL）
│       ├── liff-init.js     LIFF_ID、LIFF初期化、userId取得（currentUserId）
│       ├── calendar.js      Step1: 空き状況の取得・カレンダー描画・人数/時間の選択肢
│       └── reserve-form.js  Step2〜5: 画面遷移・入力チェック・確認画面・送信
├── gas/                     ← clasp push でGASプロジェクトへ反映
│   ├── appsscript.json      マニフェスト（タイムゾーン・Webアプリ公開設定）
│   ├── Code.js              doGet/doPost、承認・キャンセル・人数変更・代理登録、認証/権限、
│   │                        ユーザー管理、メール送信、各種バリデーション、checkConfig
│   ├── SheetService.js      スプレッドシートの読み書き、空き状況の集計、アーカイブ
│   ├── CalendarService.js   予定の作成・更新・削除、日本の祝日の取得
│   ├── NotifyService.js     Discord/Slack Webhook送信（再送・フォールバックメール）
│   ├── LineService.js       LINE Messaging API（トークン取得・プッシュ送信）、LINE診断関数
│   ├── Trigger.js           前日リマインド、アーカイブ、トリガー登録関数
│   ├── ApprovalPage.html    承認画面（HtmlServiceテンプレート）
│   ├── AdminPage.html       管理者画面（HtmlServiceテンプレート）
│   └── AdminLoginPage.html  管理者画面のログイン画面（社外アカウント用）
├── docs/
│   ├── developer-spec.md    この資料
│   ├── spec.md              元の要件定義（未転記）
│   └── test-checklist.md    デプロイ後の動作確認チェックリスト
├── .clasp.json              clasp設定（scriptId、rootDir: gas）
├── CLAUDE.md                プロジェクトのルール・引き継ぎメモ
├── TASKS.md                 開発フェーズ別のタスク一覧
└── README.md                セットアップガイド
```

GASの `.js` ファイルはすべて**同じグローバルスコープ**で読み込まれます（`import`/`export`はない）。`SheetService` などは即時関数で作った名前空間オブジェクトで、内部ヘルパーは外から見えません。`Code.js` の `formatDateTimeForDisplay_()` や `sendEmail_()` などは他のファイルからもそのまま呼ばれています。

---

## 5. データモデル（スプレッドシート）

スプレッドシートIDはスクリプトプロパティ `SPREADSHEET_ID` で指定します。

### 5.1 シート「予約一覧」

1行目がヘッダー、2行目以降が1行1予約です。列順は `SheetService.js` の `HEADERS` 定数で決まっています。

| # | 列名 | 型・形式 | 内容 |
|---|---|---|---|
| 1 | ID | UUID文字列 | `Utilities.getUuid()`。承認リンクにも使う |
| 2 | ステータス | `仮予約` / `確定` / `キャンセル` | |
| 3 | 予約日時 | `yyyy-MM-ddTHH:mm:ss`（シート上でDateに変換されることがある） | 開始日時。終了時刻は持たない |
| 4 | 人数 | 数値 | 1〜15 |
| 5 | スペース | `スタンディング・スペース` / `ラウンジ・スペース` / 空 | |
| 6 | 飲み放題 | `あり` / `なし` | |
| 7 | ご利用履歴 | `初めて` / `利用したことがある` | |
| 8 | 氏名（カタカナ） | 文字列 | フォームでは「セイ メイ」を半角スペースでつなぐ |
| 9 | 電話番号 | 文字列 | 先頭の0が消えないよう `'` 付きで保存 |
| 10 | メールアドレス | 文字列 / 空 | 正規化済み |
| 11 | 備考 | 文字列 | |
| 12 | LINE UserId | `U`で始まる文字列 / 空 | LIFFで取得。管理画面からの登録では空 |
| 13 | 登録日時 | Date | 行を追加した日時 |
| 14 | カレンダーイベントID | 文字列 / 空 | 確定時に保存。キャンセル・人数変更で使う |

**列を追加・変更するときの注意**: `getSheet_()` はシートを開くたびに1行目と `HEADERS` を比べ、違えば**1行目を `HEADERS` で上書き**します（データ行は動かしません）。そのため `HEADERS` の途中に列を挿入すると、既存データと見出しがずれます。列を増やすときは**末尾に追加**し、既存行は空欄のままでも動くようにしてください。また各画面・処理は列名（日本語の文字列）で値を参照しているので、列名の変更はコード全体の検索が必要です。

**セルの書き込み**: 外部からの入力は必ず `sanitizeCell_()` を通してから書き込みます。先頭が `= + - @` タブ・改行の文字列や、`0`で始まる数字列には先頭に `'` を付け、数式として解釈されること（数式インジェクション）や先頭の0が消えることを防ぎます。

### 5.2 シート「予約一覧_archive」

`archiveOldReservations()` が、予約日時が**180日より前**の「確定」「キャンセル」の行をここへ移します（列構成は同じ）。「仮予約」は何日経っても移しません。管理者画面・空き状況・リマインドはメインシートしか見ないため、アーカイブした予約は画面に出なくなります。

### 5.3 スクリプトプロパティに保存される実行時データ

設定値以外に、次のデータもスクリプトプロパティに書き込まれます。

| キー | 内容 |
|---|---|
| `ADMIN_EMAILS` / `VIEWER_EMAILS` | 管理画面の「ユーザーを管理」から更新される（カンマ区切り） |
| `LOGIN_SESSION_<64桁hex>` | 社外アカウントのログインセッション `{"email": "...", "expiresAt": <ミリ秒>}` |
| `EMAIL_QUOTA_ALERT_DATE` | メール残数警告を最後に出した日（1日1回に抑えるため） |

キャッシュ（`CacheService`）には、祝日一覧（`JP_HOLIDAYS_<開始>_<終了>`、6時間）とログインリンク送信の連打防止フラグ（`LOGIN_LINK_SENT_<email>`、60秒）を置いています。

---

## 6. GAS Webアプリのインターフェース

GASのWebアプリは公開URLを1つしか持てないため、クエリパラメータで処理を分けています。

### 6.1 HTTPエンドポイント

| メソッド | パラメータ | 処理 | 応答 |
|---|---|---|---|
| GET | なし | 空き状況を返す | JSON（下記） |
| GET | `?page=approval&id=<予約ID>` | 承認画面 | HTML（`ApprovalPage.html`） |
| GET | `?page=admin` | 管理者画面（権限がなければログイン画面） | HTML（`AdminPage.html` / `AdminLoginPage.html`） |
| GET | `?page=admin&session=<トークン>` | 社外アカウントのログインリンク | 同上 |
| POST | 本文＝予約JSON | 仮予約を登録 | JSON（下記） |

#### GET 空き状況

今日から予約可能な最終日（[7章](#7-業務ルール予約受付の条件)）までの日付ごとの配列を返します。

```json
[
  { "date": "2026-11-09", "available": false, "closed": true,  "closedReason": "日曜定休" },
  { "date": "2026-11-10", "available": true,  "closed": false, "closedReason": "" },
  { "date": "2026-11-23", "available": false, "closed": true,  "closedReason": "祝日（勤労感謝の日）" }
]
```

- `available`: 定休日ではなく、かつ**その日の「確定」予約の合計人数**が15人未満なら `true`
- 仮予約・キャンセルは人数に数えない。スペース別・時間帯別の判定はしない（あくまで目安）

#### POST 仮予約

**CORS対策**: GASのWebアプリはプリフライト（OPTIONS）を処理できないため、フロントは `Content-Type: text/plain;charset=utf-8` でJSON文字列を送ります（`application/json` にすると失敗します）。GAS側は `JSON.parse(e.postData.contents)` で受け取ります。

リクエスト本文:

```json
{
  "datetime": "2026-11-20T18:00:00",
  "headcount": 4,
  "space": "ラウンジ・スペース",
  "drink": "あり",
  "usageHistory": "初めて",
  "name": "ヤマダ タロウ",
  "phone": "09012345678",
  "email": "taro@example.com",
  "note": "",
  "userId": "Uxxxxxxxx..."
}
```

| 項目 | 必須 | サーバー側の検証 |
|---|---|---|
| datetime | ○ | 空でないこと。日付部分が予約可能期間を超えていないこと。定休日でないこと |
| name | ○ | 空でないこと |
| phone | ○ | 空でないこと |
| headcount | — | 指定されていれば1〜15の整数 |
| email | — | 正規化したうえで、指定されていれば形式チェック |
| space / drink / usageHistory / note / userId | — | 検証なし（そのまま保存） |

応答: 成功時 `{"success": true, "id": "<予約ID>"}`、失敗時 `{"success": false, "error": "<メッセージ>"}`。HTTPステータスはどちらも200です。

### 6.2 `google.script.run` で呼ぶサーバー関数

承認画面・管理者画面・ログイン画面のJSから呼ばれる関数です。権限が必要な関数は、最後の引数で `sessionToken`（社外アカウントのログイントークン。社内アカウントなら `null`）を受け取ります。戻り値はすべて `{ success: boolean, error?: string, ... }` 形式です。

| 関数 | 呼び出し元 | 権限チェック | 内容 |
|---|---|---|---|
| `approveReservation(id, editedData)` | 承認画面・管理者画面 | **なし**（[18章](#18-既知の制約注意点)） | 承認して確定。`editedData` は許可した列だけ反映 |
| `cancelReservation(id, sessionToken)` | 管理者画面 | 管理者 | 却下・キャンセル |
| `updateReservationHeadcount(id, headcount, sessionToken)` | 管理者画面 | 管理者 | 人数変更 |
| `createReservationByAdmin(data, sessionToken)` | 管理者画面 | 管理者 | 予約の代理登録（`data.status` は `確定` / `仮予約`） |
| `getAllUsers(sessionToken)` | 管理者画面 | 管理者 | 管理者・閲覧者の一覧 |
| `addUser(email, role, sessionToken)` | 管理者画面 | 管理者 | ユーザー追加（`role` は `admin` / `viewer`） |
| `removeUser(email, sessionToken)` | 管理者画面 | 管理者 | ユーザー削除 |
| `setUserRole(email, role, sessionToken)` | 管理者画面 | 管理者 | 権限の切り替え |
| `requestAdminLoginLink(email)` | ログイン画面 | なし（仕様） | ログインリンクをメール送信 |
| `logoutAdminSession(sessionToken)` | 管理者画面 | なし（仕様） | セッショントークンを削除 |

`approveReservation` の `editedData` で反映できるのは `予約日時, 人数, スペース, 飲み放題, ご利用履歴, 氏名（カタカナ）, 電話番号, メールアドレス, 備考` の9列だけです（`EDITABLE_FIELDS`）。`LINE UserId` やステータスは書き換えられません。

`google.script.run` は `Date` オブジェクトを返せないため、予約データを返す関数は `JSON.parse(JSON.stringify(...))` で文字列化してから返しています。

### 6.3 排他制御

予約データを読んで判定して書き込む処理（`doPost`、承認、キャンセル、人数変更、代理登録）は、`withReservationLock_()` でスクリプト全体のロック（`LockService.getScriptLock()`）を取ってから実行します。最大10秒待っても取れなければ「只今他の予約処理が混み合っています」というエラーを返します。外部通知（Discord・LINE・メール）は時間がかかるので、なるべくロックの外で送っています（カレンダー操作はロック内）。

---

## 7. 業務ルール（予約受付の条件）

| ルール | 値 | 定義場所 | 予約フォーム | 管理画面からの追加 |
|---|---|---|---|---|
| 予約できる期間 | 今日から**3か月後の同じ日**まで（その月に同じ日がなければ月末） | `BOOKING_MONTHS_AHEAD`（Code.js） | 適用 | 制限なし |
| 定休日 | **日曜・祝日** | `getClosedReason_()`（Code.js） | 適用（「休」表示で選べない） | 制限なし（特別対応用） |
| 1件の人数 | **1〜15名** | `MAX_HEADCOUNT`（Code.js / calendar.js） | 適用 | 適用（人数変更も同じ） |
| 1日の受付目安 | 確定予約の合計が**15名**に達したら「－」（受付不可）表示 | `DAILY_CAPACITY`（SheetService.js） | 表示のみ（サーバーでは拒否しない） | — |
| 時間の選択肢 | 15:00〜21:00 の30分刻み | calendar.js | 表示のみ | 15分刻みで任意 |
| 確定時のカレンダー予定 | 開始から**1時間**の予定 | CalendarService.js | — | — |

- **祝日の判定**: Googleの公開カレンダー「日本の祝日」（`ja.japanese#holiday@group.v.calendar.google.com`）から取得します。2024年頃から節分・七五三など祝日でない行事も同じカレンダーに載るようになったため、**説明欄が「祝日」で始まるものだけ**を祝日として扱います。結果は6時間キャッシュします。祝日の取得に失敗した場合は、予約受付を止めないよう日曜だけを定休日とみなします。
- **最終判断はスタッフ**: 空き状況は粗い目安です。同じ日に15名を超える申し込みが入ることもあり、承認画面で個別に判断する運用です。
- **定数を変えるとき**: `MAX_HEADCOUNT` は `gas/Code.js` と `frontend/js/calendar.js` の両方にあり、管理者画面（`AdminPage.html`）の人数入力にも `max="15"` と15の判定が直書きされています。`BOOKING_MONTHS_AHEAD` を変えるときは `calendar.js` のダミーデータの「3か月」もそろえてください（本番のカレンダーはサーバーの返す日付範囲に従うので、表示は自動的に追従します）。

### 入力値の正規化

- **メールアドレス**: `normalizeEmail_()` で全角英数記号を半角にし、前後の空白を除いてから `isValidEmail_()` で検証します。予約受付・承認時の編集・代理登録・ユーザー追加・ログインリンク要求のすべてで使います。「@」の前はdocomo・auの古いアドレス（`..` や `@` 直前の `.`）が実在するため緩め、ドメインは厳しめです。同じ正規表現が `frontend/js/reserve-form.js` にもあり、**変えるときは両方そろえます**。
- **日時の表示**: お客様・スタッフ向けの文面では `formatDateTimeForDisplay_()` で「11月20日(金) 18:00」の形にします。

---

## 8. フロントエンド（LIFF予約フォーム）

### 8.1 公開URLと設定

- 公開URL: `https://sinnovationjp-rgb.github.io/Sinnovation-LINEapp/frontend/index.html`（LIFFのエンドポイントURLとして登録済み）
- `frontend/js/liff-init.js` の `LIFF_ID`: 本番は `2011811803-LPCWIDmb`
- `frontend/js/config.js` の `GAS_ENDPOINT_URL`: GAS Webアプリの `/exec` URL

LIFFアプリは、**`@186lmmed` のMessaging APIチャネルと同じプロバイダー**に属するLINE Loginチャネルに作る必要があります。LINEのuserIdはプロバイダーごとに別の値が発行されるため、プロバイダーが違うとLIFFで取得したuserIdにプッシュ送信できません（2026-10-01に実機で確認済み。詳しい経緯は `CLAUDE.md`）。

### 8.2 画面とファイル

| 画面 | ファイル | 内容 |
|---|---|---|
| トップ | `index.html` + `liff-init.js` | 店舗紹介と「新規予約をする」ボタン（`reserve.html` へ移動） |
| Step1 日時 | `reserve.html` + `calendar.js` | 自前の月カレンダー（○空きあり／－受付不可／休 定休日）、人数・時間のプルダウン |
| Step2 スペース | `reserve-form.js` | スタンディング／ラウンジのカード選択、飲み放題の有無 |
| Step3 予約者情報 | `reserve-form.js` | セイ・メイ（カタカナ）、電話番号（必須）、メール（任意）、ご利用履歴、備考 |
| Step4 確認 | `reserve-form.js` | 入力内容の一覧（`escapeHtml()` でエスケープして表示） |
| Step5 完了 | `reserve-form.js` | 「担当者よりLINEでご連絡します」 |

### 8.3 処理の流れ

1. `liff-init.js` が `liff.init()` を実行。未ログインなら `liff.login()` でログインさせ、`liff.getProfile()` で得た userId を `currentUserId` に入れる（失敗してもフォームは使える。その場合LINE通知は届かない）
2. `calendar.js` が `GAS_ENDPOINT_URL` に GET して空き状況を取得し、カレンダーを描画。最後の日付の月まで「›」で進める
3. 確定ボタンで `reserve-form.js` が予約JSONを `text/plain` で POST。`success: true` なら完了画面へ

### 8.4 開発用のダミーモード

- `LIFF_ID` が `'YOUR_LIFF_ID'` のままなら、LIFFを初期化せず `currentUserId = 'dummy-user-id'` で動く
- `GAS_ENDPOINT_URL` が空なら、空き状況はダミーデータ、送信はコンソール出力のみ
- 空き状況の取得に**失敗したとき**もダミーデータで表示する（本番でもこの挙動。[18章](#18-既知の制約注意点)）

ローカルで確認するときは `frontend/` を任意の静的サーバー（例: `python3 -m http.server`）で開けば動きます（LIFFの機能はLINEアプリ内でのみ有効）。

---

## 9. スタッフ向け画面（承認画面・管理者画面）

どちらもGASの `HtmlService` テンプレートで、サーバーで予約データを埋め込んでから返します。埋め込みは `toSafeJson_()`（`<` を `<` にエスケープしたJSON）で行い、`</script>` による脱出を防いでいます。

### 9.1 承認画面（`?page=approval&id=XXX`）

- Discordの新規予約通知に載っているリンクから開く。予約IDを知っていれば誰でも開ける（ログイン不要）
- 予約内容が入力欄に入った状態で表示され、スタッフが修正してから「承認して確定」を押す → `approveReservation(id, editedData)`
- 予約が見つからなければ「予約が見つかりませんでした」と表示

### 9.2 管理者画面（`?page=admin`）

`frontend/admin.html` を開くと、この画面へ転送されます。

| 機能 | 管理者 | 閲覧者 |
|---|---|---|
| 予約一覧（予約日時順）、ステータス別タブ、氏名・電話番号での検索 | ○ | ○ |
| 統計（本日の予約／未対応の仮予約／今月の確定／本日の合計人数） | ○ | ○ |
| 詳細パネル（電話番号・メール・LINE連携の有無・備考など） | ○ | ○ |
| 仮予約の「承認して確定」「却下」 | ○ | — |
| 確定済みの「キャンセルにする」 | ○ | — |
| 人数の「変更」（仮予約・確定のみ） | ○ | — |
| 「予約を追加」（電話・店頭・SNSなどの代理登録） | ○ | — |
| 「ユーザーを管理」（管理者・閲覧者の追加・削除・権限変更） | ○ | — |

- 予約一覧はページを開いた時点のデータを埋め込んでいます。操作後は画面内のデータを書き換えて表示を更新しますが、他の人の操作を見るには再読み込みが必要です
- 却下・キャンセルはお客様にLINE通知が飛んで取り消せないため、実行前に確認ダイアログを出します
- 閲覧者にはボタン自体を出しませんが、**サーバー側でも必ず権限を確認**しています（画面の表示制御だけに頼らない）
- 予約の内容は `textContent` か `escapeHtml_()` を通して表示します（お客様の入力によるXSSを防ぐため）

---

## 10. 認証・権限

### 10.1 ロール

| ロール | 登録先（スクリプトプロパティ） | できること |
|---|---|---|
| `admin`（管理者） | `ADMIN_EMAILS` | すべての操作 |
| `viewer`（閲覧者） | `VIEWER_EMAILS` | 管理者画面の閲覧のみ |

- `getUserRole_(sessionToken)` が利用者のメールアドレスを特定し、上の一覧と照合して `'admin'` / `'viewer'` / `null` を返す（大文字・小文字は区別しない）
- `isAuthorizedAdmin_(sessionToken)` は `admin` のときだけ `true`。操作系の関数はすべてこれで保護する
- 管理者が0人になる操作（最後の管理者の削除・閲覧者への降格）は拒否する（ロックアウト防止）
- `ADMIN_EMAILS` は、Discord通知が失敗したときのフォールバックメールの宛先も兼ねる

### 10.2 本人確認の2つの方法

1つのWebアプリのデプロイで、予約受付用と管理者用を兼ねています。

**① sinnovation.jp（スクリプト所有者と同じWorkspaceドメイン）のアカウント**
`Session.getActiveUser().getEmail()` でメールアドレスが取れるので、Googleにログインしていればそのまま管理者画面が開きます。画面にトークンは渡しません。

**② Gmailなど社外のアカウント**
「自分として実行」のWebアプリでは、`Session.getActiveUser()` は所有者と同じドメインのユーザーにしかメールアドレスを返しません（Googleの仕様。GASプロジェクトを共有しても変わらないことを2026-10-05に確認済み）。そのため、メールでリンクを送る方式（マジックリンク）で本人確認します。

```
1. ?page=admin を開く → 権限なし → ログイン画面（AdminLoginPage.html）
2. メールアドレスを入力 → requestAdminLoginLink(email)
     ・登録済みなら 64桁のランダムトークンを作り、
       スクリプトプロパティ LOGIN_SESSION_<トークン> = {email, expiresAt(7日後)} を保存
     ・?page=admin&session=<トークン> のリンクをメールで送る
     ・未登録でも同じ応答を返す（登録の有無を推測させない）
     ・同じアドレスへの送信は1分に1回まで
3. メールのリンクを開く → トークンから email を引き、ADMIN_EMAILS / VIEWER_EMAILS と照合
4. 画面の操作のたびに sessionToken をサーバーへ送り、毎回照合し直す
```

- 権限は毎回照合し直すので、ユーザー登録を削除すればそのトークンも**即座に**無効になる
- 「ログアウト」で `logoutAdminSession()` がトークンを削除する
- 期限切れのセッションは、アクセス時と新しいリンクの発行時に削除される
- 期限切れ・無効なトークンで開いた場合は、ログイン画面に「有効期限が切れた」旨を表示する

### 10.3 WebアプリのURL（`WEB_APP_URL`）

ログインリンクやDiscordの承認リンクに載せるURLは `getWebAppUrl_()` で作ります。`ScriptApp.getService().getUrl()` は、実際には開けないURLや社内ドメイン限定の `/a/macros/<ドメイン>/` 形式のURLを返すことがあるため、スクリプトプロパティ `WEB_APP_URL`（`https://script.google.com/macros/s/〜/exec` 形式）を優先します。未設定なら `getUrl()` の `/a/macros/<ドメイン>/` を `/macros/` に直して使います。

---

## 11. 通知

### 11.1 送信先と内容

| 宛先 | 手段 | 送るタイミング |
|---|---|---|
| スタッフ | Discord（`DISCORD_WEBHOOK_URL`）またはSlack（`SLACK_WEBHOOK_URL`） | 新規予約（承認リンク付き）、確定、却下・キャンセル、人数変更、前日リマインド、各種失敗の警告、メール残数の警告 |
| お客様（LINE連携あり） | LINE Messaging API のプッシュ送信 | 仮予約受付、確定、却下・キャンセル、前日リマインド |
| お客様（メールあり） | `MailApp`（差出人名「oO SPACE」） | 仮予約受付、確定、前日リマインド（却下・キャンセルはメールなし） |
| 管理者 | `MailApp` | Discord通知が最終的に失敗したときのフォールバック、ログインリンク |

**Discordに個人情報を載せない**: Discord（Slack）への通知には、お客様の**電話番号・メールアドレスを含めません**（すべての通知が対象）。氏名・日時・人数・スペース・飲み放題・ご利用履歴・備考までです。電話番号などは承認画面・管理者画面で確認します。通知文を追加・変更するときもこのルールを守ってください。

### 11.2 NotifyService（Discord/Slack）

`NotifyService.send(message)` だけでDiscordとSlackの両方に対応します。

- URLが `discord.com` / `discordapp.com` の `/api/webhooks/` なら Discord 形式 `{content, allowed_mentions: {parse: []}}`、それ以外は Slack 形式 `{text}` で送る
- Discord は1メッセージ2000文字までなので、超える分は切り詰める
- `allowed_mentions` を空にして、氏名や備考に `@everyone` が入力されてもメンションが飛ばないようにしている
- **再送**: 最大3回。429（レート制限）はDiscordの `retry_after` に従って最大15秒待つ。5xx・通信エラーは2秒→4秒待つ。400/401/404など再送しても直らないエラーはすぐあきらめる
- **フォールバック**: それでも送れなかった場合（Webhook URL未設定を含む）は、`ADMIN_EMAILS` 全員に、失敗理由（ステータスコードと説明）と本来の通知内容をメールで送る

### 11.3 LineService（LINE Messaging API）

アクセストークンは次の優先順で取得します。

1. スクリプトプロパティ `LINE_CHANNEL_ACCESS_TOKEN`（長期トークン）があればそれを使う
2. なければ `LINE_CHANNEL_ID` と `LINE_CHANNEL_SECRET` で、`https://api.line.me/oauth2/v3/token` から**送信のたびに**15分有効なステートレストークンを取得する（現在の本番はこちら）

2の方式は、Developers Consoleでのトークン発行操作やプロバイダーの管理者権限がなくても使えます。送信は `POST https://api.line.me/v2/bot/message/push` のテキストメッセージ1通です。`pushMessage()` は成否を `true`/`false` で返し、失敗時は呼び出し元がDiscordに警告を出します。お客様が公式アカウントをブロックしている、または友だちでない場合は送信に失敗します。

### 11.4 メール（MailApp）

- `sendEmail_(to, subject, body)` は宛先が空なら何もしない。失敗してもエラーを投げず、Discordに警告を出す
- GASのMailAppには1日あたりの送信上限があります。送信前に `checkEmailQuota_()` で残数を確認し、20件を切ったらDiscordに1日1回だけ警告します

---

## 12. 外部サービス連携

| サービス | 使っている機能 | 必要な設定・権限 |
|---|---|---|
| Googleスプレッドシート | `SpreadsheetApp.openById()` | `SPREADSHEET_ID`。スクリプト所有者が編集できること |
| Googleカレンダー（店舗用） | `CalendarApp.getCalendarById()` で予定の作成・取得・タイトル変更・削除 | `CALENDAR_ID`。所有者が予定を編集できること |
| Googleカレンダー（日本の祝日） | 公開カレンダーの予定取得 | 設定不要 |
| Discord / Slack | Incoming Webhook | `DISCORD_WEBHOOK_URL` または `SLACK_WEBHOOK_URL` |
| LINE Messaging API | トークン取得、プッシュ送信、（診断用に）bot情報・プロフィール取得 | `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET`（または `LINE_CHANNEL_ACCESS_TOKEN`） |
| LINE Login / LIFF | お客様のuserId取得 | `LIFF_ID`（フロントのコードに記載。秘密情報ではない） |
| Gmail（MailApp） | メール送信 | 所有者アカウントの送信上限内 |

カレンダーの予定タイトルは `[スペース] 氏名様（人数名／飲み放題あり）`、説明欄は備考です（電話番号は入れません）。

---

## 13. 定期実行（トリガー）

| ハンドラー | 実行タイミング | 内容 | 登録用の関数 |
|---|---|---|---|
| `sendReminders` | 毎日 9時台 | **翌日**が予約日の「確定」予約に、LINE・メール・Discordでリマインド | `createDailyTrigger()` |
| `archiveOldReservations` | 毎月1日 4時台 | 180日より前の確定・キャンセルを「予約一覧_archive」へ移す | `createArchiveTrigger()` |

- 時限トリガーは `clasp push` では登録されません。GASエディタで**登録用の関数を初回だけ手動実行**してください（同じハンドラーが登録済みなら何もしません）
- ハンドラー名を変えると、既存のトリガーが動かなくなり、後述のガードにも弾かれます。変える場合はトリガーを登録し直してください
- リマインドのDiscord通知は、予約1件ごとに1通送ります

---

## 14. セキュリティ設計

### 14.1 `google.script.run` から呼べる関数（最重要）

Webアプリは「自分として実行」「全員（匿名含む）」で公開しているため、承認画面・管理者画面・ログイン画面を開いた人なら**誰でも**、ブラウザの開発者ツールから `google.script.run.<関数名>()` で、**名前の末尾が `_` でないすべてのトップレベル関数**を、スクリプト所有者の権限で実行できます。

トップレベル関数を追加するときは、必ず次のどれに当たるかを決めてください。

| 種類 | やること | 例 |
|---|---|---|
| 内部ヘルパー | 名前の末尾を `_` にする（google.script.runから呼べなくなる。代わりにエディタの関数一覧にも出なくなる） | `getSheet_`、`sendEmail_` |
| 画面から呼ぶ公開API | 誰に呼ばれても安全に作る。操作系は `isAuthorizedAdmin_(sessionToken)` で保護 | `cancelReservation`、`addUser` |
| GASエディタから手動実行する保守・診断用 | 先頭で `assertEditorRun_('関数名')` | `checkConfig`、`createDailyTrigger`、`debugLine*` |
| トリガーのハンドラー | 先頭で `assertEditorOrTriggerRun_(e, '関数名')`（エディタからの手動実行も可） | `sendReminders`、`archiveOldReservations` |

名前空間オブジェクト（`SheetService` など）の中の関数は、トップレベル関数ではないので `google.script.run` からは呼べません。

**ガードの仕組み**（`Code.js`）:

- Webアプリ経由では、`Session.getEffectiveUser()` は常にスクリプト所有者、`Session.getActiveUser()` は訪問者（匿名・社外なら空文字）になる。エディタから実行すると両者とも実行した本人で一致する。**一致しなければ拒否**（`isEditorRun_()`）
- トリガー実行時は `getActiveUser()` が取れる保証がないため、イベントオブジェクトの `triggerUid` が、このプロジェクトに登録済みで同じハンドラー名を持つトリガーのID（`Trigger.getUniqueId()`）と一致すれば許可（`isOwnTriggerRun_()`）
- 拒否時は例外を投げるので、トリガー実行が誤って拒否された場合もGASのトリガー失敗通知メールで気付ける

### 14.2 その他の対策

| 脅威 | 対策 |
|---|---|
| XSS（お客様の入力が画面でスクリプトとして動く） | 表示は `textContent` か `escapeHtml` を通す。テンプレートへの埋め込みは `toSafeJson_()` |
| スプレッドシートの数式インジェクション | 書き込み前に `sanitizeCell_()` |
| 承認時の想定外の列の書き換え | `EDITABLE_FIELDS` の許可リストだけ反映 |
| 同時操作による二重登録・二重通知 | スクリプトロック＋ステータスによる二重実行チェック |
| ログインリンクによるメールの大量送信 | 同じアドレスへは1分に1回まで |
| 登録済みアドレスの推測 | 未登録でも同じ応答 |
| Discordへの個人情報流出 | 電話番号・メールアドレスを通知に含めない |
| Discordでのメンション悪用 | `allowed_mentions: {parse: []}` |
| 秘密情報の漏えい | すべてスクリプトプロパティに置き、ソースコード・リポジトリに書かない |

---

## 15. 設定値（スクリプトプロパティ・定数）

### 15.1 スクリプトプロパティ

GASには `.env` がないため、秘密情報・環境ごとの設定はすべて **GASエディタの「プロジェクトの設定 > スクリプトプロパティ」** に手動で登録し、`PropertiesService.getScriptProperties()` で読み込みます。ソースコードには書かないでください。

| キー | 必須 | 内容 |
|---|---|---|
| `SPREADSHEET_ID` | ○ | 予約台帳のスプレッドシートID |
| `CALENDAR_ID` | ○ | 確定予約を登録するGoogleカレンダーのID |
| `DISCORD_WEBHOOK_URL` | ○※ | Discordの「#予約状況」チャンネルのWebhook URL |
| `SLACK_WEBHOOK_URL` | ※ | Discordの代わりにSlackを使う場合（Discordが優先） |
| `ADMIN_EMAILS` | ○ | 管理者のメールアドレス（カンマ区切り）。フォールバックメールの宛先も兼ねる |
| `VIEWER_EMAILS` | — | 閲覧者のメールアドレス（カンマ区切り） |
| `WEB_APP_URL` | 推奨 | `https://script.google.com/macros/s/〜/exec` 形式のWebアプリURL |
| `LINE_CHANNEL_ID` | ○※ | `@186lmmed` のMessaging APIチャネルのID |
| `LINE_CHANNEL_SECRET` | ○※ | 同チャネルのシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | ※ | 長期トークン（設定されていればID/SECRETより優先。現在は未設定） |
| `DEBUG_TEST_USER_ID` | — | LINE診断関数の送信先userId |

※ DiscordかSlackのどちらか一方、LINEは「ID+SECRET」か「ACCESS_TOKEN」のどちらか一方が必要。

設定内容は `checkConfig()`（[17章](#17-保守診断用の関数)）でまとめて確認できます。

### 15.2 コード中の定数

| 定数 | 値 | 場所 |
|---|---|---|
| `BOOKING_MONTHS_AHEAD` | 3（か月） | Code.js |
| `MAX_HEADCOUNT` | 15（名） | Code.js、frontend/js/calendar.js |
| `DAILY_CAPACITY` | 15（名） | SheetService.js |
| `LOGIN_SESSION_DAYS` | 7（日） | Code.js |
| `ARCHIVE_AFTER_DAYS` | 180（日） | SheetService.js |
| `EMAIL_PATTERN` | メール形式の正規表現 | Code.js、frontend/js/reserve-form.js |
| `GAS_ENDPOINT_URL` | GAS WebアプリURL | frontend/js/config.js |
| `LIFF_ID` | `2011811803-LPCWIDmb` | frontend/js/liff-init.js |

---

## 16. 開発・デプロイ手順

### 16.1 ブランチ運用

- `main`: 本番。GitHub Pagesと直結しているので、**mainへのマージ＝フロントの本番反映**。直接pushしない
- `develop` / `feature/xxx`（`claude/xxx` を含む）: 開発用。PR経由でmainにマージする

### 16.2 フロントエンドの反映

`frontend/` を変更してmainにマージするだけです（GitHub Pagesが自動で公開）。ビルドはありません。ブラウザやLINEアプリのキャッシュで古いJSが残ることがあるので、確認時は再読み込みしてください。

### 16.3 GASの反映（clasp）

初回のみ:

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

コードの反映:

```bash
clasp push
```

**`clasp push` だけでは本番（`/exec` のURL）に反映されません。** 本番に出すには、既存のデプロイを新しいバージョンで更新します（新しいデプロイを作るとURLが変わり、`config.js`・`WEB_APP_URL`・Discordに出した過去の承認リンクがすべて使えなくなるため、**必ず既存のデプロイIDを指定**してください）。

```bash
clasp deployments
```

```bash
clasp deploy --deploymentId <既存のデプロイID> --description "変更内容"
```

GASエディタの「デプロイ > デプロイを管理 > 編集 > バージョン: 新バージョン」でも同じことができます。

### 16.4 デプロイ後の確認

`docs/test-checklist.md` を上から順に実施します（仮予約 → 承認 → 管理画面 → リマインド → セキュリティ、の順に依存関係がつながっています）。

### 16.5 テストについて

自動テストはありません。GASの処理はGoogleのサービスに依存しているため、動作確認は実機（本番またはテスト用のGASプロジェクト）で行います。テスト用の予約を作ったら、管理画面からキャンセルしておくと空き状況やリマインドに影響しません。

---

## 17. 保守・診断用の関数

すべて **GASエディタの関数選択プルダウンから実行**します（Webアプリ経由では拒否されます）。結果は「実行ログ」に出ます。

| 関数 | ファイル | 用途 |
|---|---|---|
| `checkConfig()` | Code.js | スクリプトプロパティの設定状況と、スプレッドシート・カレンダー・LINEに実際にアクセスできるかをまとめて確認。**動かないときはまずこれ** |
| `createDailyTrigger()` | Trigger.js | リマインド用トリガーの登録（初回のみ） |
| `createArchiveTrigger()` | Trigger.js | アーカイブ用トリガーの登録（初回のみ） |
| `sendReminders()` | Trigger.js | リマインドの手動実行（翌日分が実際に送られる点に注意） |
| `archiveOldReservations()` | Trigger.js | アーカイブの手動実行 |
| `fixPhoneNumberLeadingZeros()` | SheetService.js | 過去データで数値化して先頭の0が消えた電話番号を一括修正 |
| `debugDiscordWebhook()` | NotifyService.js | Discordへテスト送信し、ステータスと応答を表示 |
| `debugLineConnection()` | LineService.js | LINEのアクセストークンが取れるか確認 |
| `debugLineBotInfo()` | LineService.js | 設定中のチャネルがどの公式アカウントか（`@186lmmed` か）確認 |
| `debugLineTestPushFromProperty()` | LineService.js | `DEBUG_TEST_USER_ID` にテスト通知を送る |
| `debugLineFriendStatus()` | LineService.js | `DEBUG_TEST_USER_ID` が今のチャネルから見て友だちか確認（404なら別プロバイダーのuserIdの可能性） |
| `debugLineTestPush(userId)` | LineService.js | 引数でuserIdを渡すテスト送信（エディタの実行ボタンは引数を渡せないので、通常は上のFromProperty版を使う） |

### よくあるトラブルと切り分け

| 症状 | 確認すること |
|---|---|
| Discordに通知が来ない | `debugDiscordWebhook()`。管理者にフォールバックメールが届いていれば、その「理由」に原因が書いてある（404ならWebhookが削除されている） |
| LINEに通知が来ない | Discordに「⚠️ LINE〜の送信に失敗」が出ているか → `debugLineConnection()` → `debugLineBotInfo()` → `debugLineFriendStatus()`。お客様がブロックしていないか、LIFFとMessaging APIチャネルが同じプロバイダーか |
| 予約フォームのカレンダーが変（全部ダミーっぽい） | ブラウザのコンソールに「空き状況の取得に失敗しました」が出ていないか。`GAS_ENDPOINT_URL` が最新の `/exec` URLか |
| 社外スタッフがログインリンクを開けない | `checkConfig()` で `WEB_APP_URL` が `https://script.google.com/macros/s/〜/exec` 形式か |
| 管理画面で通信エラー | 1つのブラウザで複数のGoogleアカウントにログインしているとGASの通信が失敗することがある → シークレットウィンドウで開き直す |
| リマインドが届かない | GASの「トリガー」画面に `sendReminders` があるか、「実行数」画面で失敗していないか |

---

## 18. 既知の制約・注意点

コードを読んで分かる、仕様上の割り切りや注意点です。変更するかどうかは運用と相談して決めてください。

1. **承認には権限チェックがない**: `approveReservation` は承認リンク（予約IDはUUIDで推測困難）を知っていれば誰でも実行できる仕様です。Discordのチャンネルに入れる人＝承認できる人、という前提です。
2. **キャンセル済みの予約も承認リンクから確定できてしまう**: `approveReservation` は「確定済み」だけをスキップし、「キャンセル」はチェックしていません。古い承認リンクを開いて押すと、キャンセル済みの予約が確定に戻り、カレンダー登録とお客様への確定通知が行われます。承認画面も、ステータスに関係なく「仮予約・承認待ち」と表示します。
3. **空き状況は目安で、サーバー側では定員を強制しない**: `doPost` は1日の合計人数を確認しません。仮予約も人数に数えないので、同じ日に申し込みが集中することがあります（スタッフが承認時に判断する運用）。
4. **空き状況の取得に失敗するとダミーデータを表示する**: 本番でもGASへのfetchが失敗するとダミーの空き状況が出ます。その日が実際に予約できるかはサーバー側の検証（期間・定休日）に頼っています。
5. **過去の日付・営業時間外もサーバーでは拒否しない**: `doPost` は過去日や時刻の範囲（15:00〜21:00）を検証しません（フォームでは選べない）。`space`・`drink` などの値も検証せずに保存します。
6. **カレンダーの予定は1時間固定**: 利用時間の入力はなく、開始時刻から1時間の予定を作ります。承認画面で予約日時を変えた場合は、変更後の日時で登録されます。
7. **人数変更以外の編集は管理画面にない**: 確定後に日時やスペースを変えるには、キャンセルして登録し直すか、スプレッドシートとカレンダーを手で直す必要があります（手で直した場合、カレンダーとシートの整合はとれません）。
8. **人数変更・管理画面からの追加ではお客様に連絡しない**: お客様からの依頼で変更する想定のためです。
9. **アーカイブ後のデータは画面に出ない**: 180日より前の予約は「予約一覧_archive」シートを直接見る必要があります。
10. **スプレッドシートの全行読み込み**: 1件の検索でもシート全体を読み込んでいます。行数が増えるほど遅くなるため、アーカイブで行数を抑えています。
11. **ヘッダー行の自動上書き**: [5.1](#51-シート予約一覧) のとおり、`HEADERS` の途中に列を足すとデータがずれます。
12. **旧LIFF由来のuserId**: 旧LIFF（`2011761592-fPsPphNA`、別プロバイダー）で取得したuserIdが残っている予約には、LINE通知が届きません。
13. **ドキュメントのずれ**: `docs/spec.md` は未記入です。`docs/test-checklist.md` の「0. 前提確認」は `LINE_CHANNEL_ACCESS_TOKEN` を挙げていますが、現在の本番は `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET` を使っています。

---

## 19. 関連ドキュメント

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | プロジェクトのルール、コーディング規約、作業の引き継ぎメモ（LINE公式アカウント切り替えの経緯など） |
| `README.md` | 初期セットアップ（clasp、事前準備） |
| `TASKS.md` | 開発フェーズ別のタスクと進捗 |
| `docs/test-checklist.md` | デプロイ後の動作確認チェックリスト |
| `docs/spec.md` | 元の要件定義（未転記） |

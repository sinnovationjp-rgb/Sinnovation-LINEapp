# SPACE予約システム — Claude Code セットアップガイド

LINE LIFFを使ったスペース予約システムをClaude Codeで構築するための手引きです。

## 全体の考え方

作業は大きく2種類に分かれます。

- **Claude Codeが書ける部分**：フロントエンド(HTML/CSS/JS)、GASのコード、Git操作全般
- **人がブラウザで手動設定する部分**：LINE DevelopersでのLIFFアプリ発行、Googleカレンダー・スプレッドシートの作成、Discord/SlackのWebhook発行、GitHub Pagesの有効化、claspのログイン認証

後者はOAuth認証やAPIキー発行が絡むため自動化できません。先に済ませてからClaude Codeでの実装に入るとスムーズです。

## 事前準備チェックリスト（手動）

- [ ] GitHubリポジトリを作成
- [ ] LINE Developersで LIFFアプリを発行し、LIFF IDを控える（担当: 川合）
- [ ] Googleカレンダーで予約用の公開カレンダーを作成し、カレンダーIDを控える（担当: 川合）
- [ ] Googleスプレッドシートで予約管理台帳「SPACE予約管理」を作成し、スプレッドシートIDを控える（担当: 川合）
- [ ] Discordの「#予約状況」チャンネルのWebhook URLを発行（初期はSlack Webhookで代用可）
- [ ] LINE公式アカウントのMessaging APIチャネルアクセストークンを発行

## Claude Codeのインストール

**macOS / Linux / WSL（推奨・ネイティブインストーラ）:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**
```powershell
irm https://claude.ai/install.ps1 | iex
```

npm経由でも入れられます（その場合Node.js 22以上を推奨。古いバージョンでも警告は出ますがインストール自体は完了します）。
```bash
npm install -g @anthropic-ai/claude-code
```

インストール後、リポジトリのルートで以下を実行すると対話セッションが始まります。Pro/Max/Team/Enterprise/Consoleいずれかのアカウントが必要です（無料のClaude.aiプランではClaude Codeは使えません）。
```bash
claude
```

最新のインストール方法は https://code.claude.com/docs/en/setup で随時確認してください。

## claspのセットアップ（GASへのデプロイ用）

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "SPACE予約システム" --rootDir ./gas
```

`clasp login`はOAuth認証を伴うため人が一度だけブラウザで行う必要があります。以降の`clasp push`・`clasp deploy`はClaude Codeにコマンド実行を任せられます。

## 推奨ディレクトリ構成

```
line-space-reservation/
├── frontend/
│   ├── index.html
│   ├── reserve.html
│   ├── complete.html
│   ├── css/style.css
│   └── js/
│       ├── liff-init.js
│       ├── calendar.js
│       └── reserve-form.js
├── gas/
│   ├── appsscript.json
│   ├── Code.js
│   ├── CalendarService.js
│   ├── SheetService.js
│   ├── NotifyService.js
│   ├── LineService.js
│   ├── ApprovalPage.html
│   └── Trigger.js
├── docs/
│   └── spec.md
├── .clasp.json
├── .gitignore
├── CLAUDE.md
├── TASKS.md
└── README.md
```

## gas/appsscript.json

```json
{
  "timeZone": "Asia/Tokyo",
  "exceptionLogging": "STACKDRIVER",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "runtimeVersion": "V8"
}
```

## .gitignore

```
node_modules/
.clasprc.json
*.log
.DS_Store
```

## 進め方

1. 事前準備チェックリストを済ませる
2. このREADME・CLAUDE.md・TASKS.mdをリポジトリ直下に配置
3. リポジトリのルートで `claude` を起動
4. TASKS.mdのPhase 1から順に、1フェーズずつ実装を依頼・動作確認
5. Phase 6で結合テストし、LIFFエンドポイントを本番URLに更新

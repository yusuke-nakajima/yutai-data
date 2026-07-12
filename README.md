# yutai-data — 株主優待カレンダー データ配信リポジトリ

株主優待カレンダーアプリが起動時に取得するマスタデータ。GitHub Pagesで静的配信する(費用¥0)。

## ファイル

| ファイル | 内容 | 更新方法 |
|---|---|---|
| `master.json` | 東証上場 内国株式の銘柄マスタ(コード・社名・市場区分) | `scripts/gen-master.js` で自動生成 |
| `yutai.json` | 優待データ(優待内容・権利確定月・確定日) | **このファイルを手で編集する** |

## yutai.json の書式

```json
{ "code": "8267", "name": "イオン", "months": [2, 8], "benefit": "オーナーズカード...", "day": 20 }
```

- `months`: 権利確定月(複数可)
- `day`: 権利確定日。省略時は月末(ダイドー(1/20確定)のような銘柄のみ指定)
- 編集後は `node -e "JSON.parse(require('fs').readFileSync('yutai.json','utf8'))"` でJSONが壊れていないか確認してから push

⚠️ 初期データは2026年1月時点の参考情報。優待は変更・廃止が頻繁にあるため各社IRで要確認。

## master.json の更新手順

**自動化済み**: GitHub Actions(`.github/workflows/update-master.yml`)が週1回JPXから最新の銘柄一覧を取得し、差分があればcommitする。手動で更新したい場合はActionsタブから「Update master.json」をRun workflowするか、以下をローカルで実行:

1. [JPX 東証上場銘柄一覧](https://www.jpx.co.jp/markets/statistics-equities/misc/01.html) から `data_j.xls` をダウンロード
2. `npm install xlsx --no-save && node scripts/gen-master.js data_j.xls master.json`

## 公開手順(初回のみ)

1. GitHubに **public** リポジトリ `yutai-data` を作成し、このディレクトリをpush
2. リポジトリの Settings → Pages → Source: 「Deploy from a branch」、Branch: `main` / `(root)` を選択
3. 数分後 `https://<ユーザー名>.github.io/yutai-data/yutai.json` で配信される
4. アプリ側 `src/config.ts` の `DATA_BASE_URL` に `https://<ユーザー名>.github.io/yutai-data` を設定

# yutai-data — 株主優待カレンダー データ配信リポジトリ

株主優待カレンダーアプリが起動時に取得するマスタデータ。GitHub Pagesで静的配信する(費用¥0)。

## ファイル

| ファイル | 内容 | 更新方法 |
|---|---|---|
| `master.json` | 東証上場 内国株式の銘柄マスタ(コード・社名・市場区分・優待実施フラグ`y`) | `scripts/gen-master.js` で自動生成 |
| `yutai.json` | 優待データ(優待内容・権利確定月・確定日) | **このファイルを手で編集する** |
| `yutai-codes.json` | 優待実施銘柄の証券コード一覧。master.jsonの`y`フラグの元データ | **このファイルを手で編集する**(下記手順) |
| `tdnet-seen.json` | TDnet開示検知の処理済みID一覧 | 自動更新(触らない) |

## yutai.json の書式

```json
{ "code": "8267", "name": "イオン", "months": [2, 8], "benefit": "オーナーズカード...", "day": 20 }
```

- `months`: 権利確定月(複数可)
- `day`: 権利確定日。省略時は月末(ダイドー(1/20確定)のような銘柄のみ指定)
- `tiers`(任意): 株数区分ごとの優待内容 `[{ "shares": 100, "benefit": "..." }, ...]`。調査時にティア表が確認できたら記録する(benefitは最低ライン中心の1行要約のまま維持)
- 編集後は `node -e "JSON.parse(require('fs').readFileSync('yutai.json','utf8'))"` でJSONが壊れていないか確認してから push

⚠️ 初期データは2026年1月時点の参考情報。優待は変更・廃止が頻繁にあるため各社IRで要確認。

## master.json の更新手順

**自動化済み**: GitHub Actions(`.github/workflows/update-master.yml`)が週1回JPXから最新の銘柄一覧を取得し、差分があればcommitする。生成時に `yutai-codes.json` を読んで優待実施銘柄に `y:1` を付与する。手動で更新したい場合はActionsタブから「Update master.json」をRun workflowするか、以下をローカルで実行:

1. [JPX 東証上場銘柄一覧](https://www.jpx.co.jp/markets/statistics-equities/misc/01.html) から `data_j.xls` をダウンロード
2. `npm install xlsx --no-save && node scripts/gen-master.js data_j.xls master.json`

## 優待開示の自動検知(TDnet)

GitHub Actions(`.github/workflows/check-tdnet.yml`)が平日18:30(JST)にTDnetの開示一覧をチェックし、表題に「株主優待」を含む開示を見つけると **Issue を自動起票**する(ラベル: `yutai-update`)。Issueの通知メールが届いたら、記載のチェックリストに沿って yutai.json / yutai-codes.json を更新する。手動チェックは Actions タブから「Check TDnet yutai disclosures」を日付指定で実行できる。

## 優待の有無(yutai-codes.json)の更新手順

優待の新設・廃止があったら `codes` 配列にコードを追加/削除して push する。ただし**配信される master.json に反映されるのは再生成時**なので、すぐ反映したい場合は Actions タブから「Update master.json」を手動実行する(放置しても週次実行で反映される)。

## 公開手順(初回のみ)

1. GitHubに **public** リポジトリ `yutai-data` を作成し、このディレクトリをpush
2. リポジトリの Settings → Pages → Source: 「Deploy from a branch」、Branch: `main` / `(root)` を選択
3. 数分後 `https://<ユーザー名>.github.io/yutai-data/yutai.json` で配信される
4. アプリ側 `src/config.ts` の `DATA_BASE_URL` に `https://<ユーザー名>.github.io/yutai-data` を設定

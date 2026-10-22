# AMATERASU — 国際情勢・危機分析ダッシュボード

1週間分の国際ニュースを毎時収集し、Claude（Anthropic API）が「事実 → 背景 → 影響 → シナリオ → 結論」の5段階で分析して、**危機度の高いニュースから順に**表示する静的サイトです。

- 公開URL: **https://tani1794.github.io/Amaterasu/**
- PHP は一切使っていません（HTML / CSS / Vanilla JS + Node.js スクリプト + GitHub Actions）
- 記事本文は転載しません。見出し・AIによる独自要約・元記事へのリンクのみを掲載します

## 構成

```
GitHub Actions（毎時0分 + 手動実行 + main への push）
  ├ scripts/fetch-news.mjs     RSS取得 → data/raw-news.json（直近7日・重複除去）
  ├ scripts/fetch-markets.mjs  市場データ取得 → data/markets.json（失敗時は前回値を保持）
  ├ scripts/analyze.mjs        Claudeで5段階分析 → data/news.json, data/ai-competitors.json
  ├ scripts/validate-data.mjs  JSON形式チェック（失敗したらコミットしない）
  ├ data/*.json を自動コミット
  └ GitHub Pages へデプロイ
ブラウザ: index.html が data/*.json を読み込み、開いたまま60分ごとに再取得
```

| パス | 役割 |
|---|---|
| `index.html`, `css/`, `js/` | フロントエンド（`js/main.js` 読込・自動更新、`js/render.js` 描画、`js/charts.js` グラフ） |
| `scripts/feeds.json` | 取得するRSSの一覧（追加・削除はここを編集） |
| `scripts/lib/classify.mjs` | APIキー未設定時に使うキーワード分類（ルールベース） |
| `scripts/fixtures/` | ネットワーク不要のローカル検証用サンプル（架空の見出し） |
| `.github/workflows/hourly-update.yml` | 毎時更新とデプロイ |

### サイトのセクション
1. 🚨 危機アラート（危機度TOP5、7以上は赤いパルス＋速報ティッカー）
2. 🌏 国際政治・戦争／紛争
3. 🇯🇵 日本政治
4. 💹 経済・日本の金融と株価（日経平均・TOPIX・ドル円・米10年債・日本10年債・WTI・金のグラフ）
5. 🤖 AI競合動向（企業 × 新モデル/資金調達/提携/規制 のマトリクス）
6. 🧭 今後どうすべきか（各分析の結論を統合した行動指針）

### 危機度スコア
| スコア | 基準 |
|---|---|
| 9-10 | 戦争の拡大・核・大規模テロ・金融危機・大災害 |
| 7-8 | 軍事衝突・政権崩壊・市場の急落（3%以上）・重大な制裁 |
| 4-6 | 外交摩擦・重要な選挙・政策金利の変更 |
| 1-3 | 通常の政治経済ニュース |

日経平均・TOPIX が前日比 -3% 以下になった場合は、市場データから危機アラート（7、-5%以下は8）を自動生成します。

## セットアップ手順

### 1. GitHub Secrets に APIキーを登録（必須）
1. https://console.anthropic.com/ で API キーを発行
2. リポジトリの **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `ANTHROPIC_API_KEY` / Secret: 発行したキー → **Add secret**

APIキーは GitHub Actions の実行時に環境変数として渡されるだけで、フロントエンドのコードやデータには一切含まれません。未設定の間はキーワードによる「暫定分類」で動作し、画面に「AI分析待ち」と表示されます。

#### 任意の設定（Settings → Secrets and variables → Actions → **Variables** タブ）
| 変数名 | 既定値 | 説明 |
|---|---|---|
| `ANALYSIS_MODEL` | `claude-sonnet-5-5` | 分析に使うモデル |
| `ANALYSIS_EFFORT` | `medium` | 思考の深さ（`low` / `medium` / `high`）。上げるほど高品質・高コスト |
| `MAX_ANALYZE_PER_RUN` | `40` | 1回の実行でAI分析する新着記事の上限（コスト上限の調整用） |

> 分析済みの記事は URL 単位でキャッシュされ、毎時の実行では新着記事だけを分析します。初回は上限件数ずつ数時間かけて分析が進みます。

### 2. GitHub Pages を有効化（初回のみ・1クリック）
1. リポジトリの **Settings → Pages**
2. **Build and deployment → Source** を **「GitHub Actions」** に変更
3. **Actions タブ → Hourly update → Run workflow** で初回実行（以後は毎時自動）

数分後に https://tani1794.github.io/Amaterasu/ で公開されます。

### 3. ローカルで動かす（任意）
```bash
npm install
npm run update:fixtures    # ネットワーク不要のサンプルデータで data/ を生成
npm run serve              # http://localhost:3000 で表示
```
- 実データで更新する場合: `ANTHROPIC_API_KEY=sk-... npm run update`
- サンプルデータで `data/` を上書きした場合、コミット前に `git checkout data/` で戻してください（毎時の Actions が実データで上書きもします）

## 毎時更新の確認方法
1. **Actions タブ** → 「Hourly update」の実行履歴が毎時並んでいること（緑のチェック）
2. **コミット履歴** に `chore(data): hourly update ...` が毎時追加されていること
3. **サイト右上** の「最終更新: ○時○分」が1時間以内であること
4. 各フィード・市場データの取得成否は https://tani1794.github.io/Amaterasu/data/fetch-log.json で確認できます（取得できないフィードはスキップされ、ここに記録されます）

> GitHub の cron は混雑時に数分〜十数分遅れることがあります。また、リポジトリに60日間コミットが無いと定期実行が停止しますが、本サイトは毎時データをコミットするため通常は止まりません。

## Google 検索への登録（Google Search Console）
本サイトには `sitemap.xml`・`robots.txt`・meta description・canonical・OGP・構造化データ（JSON-LD）を設定済みです。

1. https://search.google.com/search-console を開き、Google アカウントでログイン
2. **プロパティを追加 → 「URL プレフィックス」** を選び、`https://tani1794.github.io/Amaterasu/` を入力
3. 所有権の確認方法で **「HTML タグ」** を選び、表示された `<meta name="google-site-verification" content="...">` をコピー
4. `index.html` の `<head>` 内（`<meta name="theme-color" ...>` の下あたり）に貼り付けてコミット → Actions のデプロイ完了後に **「確認」** を押す
   - 「HTML ファイル」方式を選んだ場合は、ダウンロードした `googleXXXX.html` をリポジトリ直下に置き、`.github/workflows/hourly-update.yml` の「Build site artifact」の `cp` 対象にも追加してください
5. 左メニュー **サイトマップ** で `sitemap.xml` を送信
6. **URL 検査** でトップページを入力し **「インデックス登録をリクエスト」**

インデックス登録には数日〜数週間かかることがあります。

## ニュースソース
`scripts/feeds.json` で管理しています。NHK・BBC・Al Jazeera・The Guardian・TechCrunch・The Verge・OpenAI・Google の公式RSSに加え、公式RSSを提供していない Reuters・AP・日本経済新聞と日本政治・AI企業の話題は Google News の検索RSS経由で見出しとリンクのみ取得します。

## 市場データ
銘柄ごとに複数ソースを順に試し、すべて失敗した場合は前回値を保持して「前回値」バッジと最終取得時刻を表示します。

| 銘柄 | ソース（優先順） |
|---|---|
| 日経平均 / TOPIX | Stooq → Yahoo Finance |
| ドル円 | Stooq → Yahoo Finance |
| 米10年債利回り | Stooq → FRED (DGS10) → Yahoo Finance |
| 日本10年債利回り | Stooq → 財務省「国債金利情報」 |
| WTI原油 / 金 | Stooq → Yahoo Finance |

## 免責事項
本サイトは情報提供を目的としており、投資助言ではありません。AIによる分析は誤りを含む可能性があります。記事の著作権は各報道機関に帰属します。

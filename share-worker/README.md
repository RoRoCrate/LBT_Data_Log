# 共有リンク用 Cloudflare Worker

このWorkerはTRPG記録管理室の共有データをDEFLATE-RAWで圧縮し、Base64URL文字列としてWorkers KVに保存します。共有リンクには12文字のIDだけを含めます。保存期限は生成から24時間です。

## セットアップ

1. Cloudflareにログインし、Workers & Pagesから新しいWorkerを作成するか、Wrangler CLIを利用できる環境を用意します。
2. Workers KVでNamespaceを作成し、そのIDを `wrangler.toml` の `REPLACE_WITH_KV_NAMESPACE_ID` に設定します。
3. `wrangler.toml` の設定を使ってデプロイします。Node.js互換機能（`node:zlib`）に対応した現在のCloudflare Workersランタイムを使用してください。
4. 発行されたWorker URL（例：`https://trpg-record-share.<subdomain>.workers.dev`）をコピーします。
5. サイト側 `app.js` の `SHARE_API_BASE` をそのURLに変更します。
6. `app.js` をGitHub Pagesへ公開します。

## API

- `POST /api/share`：JSON形式の共有データを受け付け、DEFLATE-RAW圧縮後にKVへ24時間保存し、IDを返します。
- `GET /api/share/{id}`：IDからデータを取得・展開してJSONで返します。有効期限切れは404です。
- CORSは `https://rorocrate.github.io` のみ許可します。独自ドメインを使う場合は `src/index.js` の `ALLOWED_ORIGIN` を変更してください。

## 仕様・制限

- 共有IDは暗号学的乱数9バイトをBase64URL化した12文字です。
- 保存時にKVの `expirationTtl: 86400` を指定し、取得時にも埋め込んだ期限を検査します。
- 最大リクエスト本文サイズは200,000バイトです。
- このWorkerは公開プレビュー用のデータのみを受け付け、アプリ全体のlocalStorageデータは保存しません。
- 共有URLは `#s=ID` 形式です。サイトのURL部分を含めて100文字以内を目標とします。
- CloudflareアカウントやKVの利用上限・料金が適用されます。期限切れ時刻ちょうどに全エッジから即時削除される保証ではありませんが、Workerは期限超過データを返しません。
- 共有リンクを知っている人は内容を閲覧できます。秘密情報は共有しないでください。

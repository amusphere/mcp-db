# MCP DB Server (Node.js)

## 各 LLM コーディングエージェントへの導入ガイド

### 1) 共通：サーバの起動

#### npm（ローカル）
```shell
npm install
npm run build
npm start
```

開発時はホットリロード付きで `npm run dev` を利用できます。
Codex CLI の設定例:

```toml
[mcp_servers."mcp-db"]
command = "npm"
args = ["run", "start"]
```

#### npx（ワンショット実行）
ローカルに Node.js さえあれば、ビルド無しで以下のように起動できます。

```shell
npx -y @amusphere/mcp-db --db-url "sqlite:///./dev.db" --port 8080
```

`--db-url` は `--host` のエイリアスで、`MAX_ROWS` や `ALLOW_WRITES` なども CLI 引数で上書きできます。Codex から直接起動する場合の設定例:

```toml
[mcp_servers.Context7]
command = "npx"
args = ["-y", "@amusphere/mcp-db", "--host", "sqlite:///./dev.db"]
```

#### Docker
```shell
docker build -t mcp-db:latest .
docker run --rm -p 8080:8080 \
  -e DB_URL='postgresql://user:pass@localhost:5432/appdb' \
  -e ALLOW_WRITES=false -e ALLOW_DDL=false \
  mcp-db:latest
```

### 2) Codex（CLI/エージェントが MCP HTTP ツールをサポートする前提）
- `mcp.json` のツール定義を Codex のツール登録に読み込み、エンドポイント URL を `http://localhost:8080` に設定します。
- 動作確認は以下の順番で行ってください。
  1. `db.tables` でテーブル一覧を取得
  2. `db.describe_table` で対象テーブルのカラムを確認
  3. `db.execute` で `SELECT ... LIMIT` を実行
- 書き込み系操作はサーバ環境変数 `ALLOW_WRITES=true` とリクエスト側 `allow_write=true` の二重許可がない限り拒否されます。

### 3) Cloud Code（VS Code / JetBrains）
- ローカルで本 MCP サーバを並走させ、Cloud Code から HTTP ツールとして `POST /tools/db.*` を呼び出します。
- `.env` や Cloud Code のデプロイ設定で `DB_URL` などの環境変数を指定してください。
- 例: `curl -s -X POST http://localhost:8080/tools/db.tables -H 'Content-Type: application/json' -d '{}'`
- Cloud Code 側では `http://localhost:8080/tools/db.execute` を HTTP ツールとして登録し、Body を JSON で送信します。

### 4) そのほかのエージェント（Claude Desktop, Cursor など）
- Claude Desktop (MCP): `mcp.json` を読み込み、エンドポイントを `http://localhost:8080` に設定。
- Cursor: Custom Tools (HTTP) として 3 エンドポイントを登録し、JSON Body でパラメータを送信。
- どのエージェントでも `db.tables` → `db.describe_table` → `db.execute` の順で利用する運用を推奨します。

### 5) 安全運用メモ
- 既定は READ ONLY。大量取得を避け、必要な列・条件・`LIMIT` を付けてください。
- 書き込みはサーバ設定とリクエストの二重ゲートが必要です。
- DDL は `ALLOW_DDL=true` を明示しない限り拒否されます。
- `ALLOWLIST_TABLES` を設定すると、許可されていないテーブルを参照する SQL は 403 で拒否されます。
- `MAX_ROWS` と `QUERY_TIMEOUT_SEC` を環境に合わせて調整し、負荷やレスポンス遅延を抑えてください。

---

## プロジェクト概要
- Node.js + Fastify で実装した独立 MCP サーバです。既定で読み取り専用、環境変数でポリシー制御が可能です。
- MCP ツールとして `db.tables` / `db.describe_table` / `db.execute` を提供し、HTTP エンドポイント `/tools/db.*` で公開します。
- 監査ログは JSON 形式でメソッド、分類、処理時間、行数／rowcount、エラーを標準出力に記録します。

## ディレクトリ構成
```
mcp-db/
├─ src/
│  ├─ config.ts
│  ├─ db.ts
│  ├─ index.ts
│  └─ routes.ts
├─ mcp.json
├─ openapi.yaml
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
├─ .eslintrc.cjs
├─ .gitignore
└─ README.md
```

## 環境変数
| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `DB_URL` | `sqlite:///./dev.db` | 接続先 DB。リクエスト `db_url` が指定されていればそちらを優先。 |
| `MAX_ROWS` | `500` | 読み取り時の上限件数。`row_limit` が指定されてもこの値を超えません。 |
| `QUERY_TIMEOUT_SEC` | `20` | DB クエリのタイムアウト秒数。超過時は 504 を返します。 |
| `ALLOW_WRITES` | `false` | サーバ側で書き込みを許可するか。リクエスト `allow_write=true` と併用で初めて実行可能。 |
| `ALLOW_DDL` | `false` | DDL 実行を許可するか。 |
| `ALLOWLIST_TABLES` | 空文字 | `schema.table` のカンマ区切り。設定時は一致しないテーブルを 403 で拒否。 |
| `REQUIRE_API_KEY` | `false` | `true` の場合、すべてのエンドポイントで `X-API-Key` ヘッダを検証。 |
| `API_KEY` | 空文字 | API キーの期待値。 |

`.env.example` をコピーし、必要に応じて値を更新してください。

## MCP ツール API
| ツール | 入力 | 出力 |
| --- | --- | --- |
| `db.tables` | `{ db_url?: string, schema?: string }` | `{ tables: string[] }`（allowlist があればフィルタ済み） |
| `db.describe_table` | `{ db_url?: string, schema?: string, table: string }` | `{ columns: [{ column_name, data_type, is_nullable }] }` |
| `db.execute` | `{ db_url?, sql, args?, allow_write?, row_limit? }` | 読み取り時 `{ rows, truncated }`／書込み時 `{ rowcount }` |

分類ロジック：先頭キーワードで `read/write/ddl/unknown` を判定し、複数ステートメントや未許可テーブルを検出すると 400/403 を返します。

## ローカル開発
- 依存関係のインストール: `npm install`
- TypeScript ビルド: `npm run build`
- ホットリロード開発: `npm run dev`
- Lint: `npm run lint`
- 型チェック: `npm run typecheck`

## Docker / Compose
- `docker-compose up --build` で API と Postgres をローカル検証できます。
- Compose で提供する Postgres への接続例: `postgresql://mcp:password@db:5432/mcp`

## 監査ログ
- JSON フォーマットで `tool`, `category`, `duration_ms`, `rows`/`rowcount`, `error` を出力します。
- 組織のログ収集基盤に転送することで、異常クエリや失敗の追跡が容易になります。

## 使い方スニペット
```shell
# テーブル列挙
curl -s http://localhost:8080/tools/db.tables -X POST -H 'Content-Type: application/json' -d '{}'

# カラム記述
curl -s http://localhost:8080/tools/db.describe_table -X POST -H 'Content-Type: application/json' \
  -d '{"table":"public.users"}'

# 参照
curl -s http://localhost:8080/tools/db.execute -X POST -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT id,email FROM public.users WHERE email=:email LIMIT 50","args":{"email":"alice@example.com"}}'

# 書き込み（両方の許可が必要）
curl -s http://localhost:8080/tools/db.execute -X POST -H 'Content-Type: application/json' \
  -d '{"sql":"UPDATE public.users SET name=:n WHERE id=:id","args":{"n":"Alice","id":1},"allow_write":true}'
```

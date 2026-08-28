# PaperStich

Canvasを壁紙合成の唯一の描画処理として扱う、Tauri + TypeScript + Rust製のLinuxマルチモニター壁紙アプリです。

[English](README.md)

## 対応環境

- Linux / X11
- `xrandr` が利用できる環境
- GNOME、Cinnamon、MATE
- Waylandは現在未対応

壁紙の適用には `gsettings` も必要です。

## 現在の構成

- TypeScript: モニター配置UI、画像ライブラリ、FitMode、Canvas合成
- Rust: XRandRによるモニター検出、PNG保存、GSettingsによる壁紙適用
- Tauri: WebViewとRust Commandの接続

Canvasは実際のデスクトップ全体の解像度で描画し、CSSで表示時だけ縮小します。そのため「プレビューに表示されている内容」をPNGにして、そのまま壁紙へ適用できます。

## 使い方

1. 「画像ディレクトリを追加」で画像フォルダーを選択するか、アプリウィンドウへディレクトリをドラッグ＆ドロップします。
2. プレビュー上のモニターをクリックします。
3. 画像をクリックしてモニターへ割り当てます。
4. 必要に応じて表示方法を選び、「壁紙を適用」を押します。

選択した画像はアプリ内で合成され、`$XDG_CACHE_HOME/paperstich/merged.png`（未設定時は`~/.cache/paperstich/merged.png`）へ保存されます。

## ソースから実行

### 前提パッケージ（Debian / Ubuntu）

TauriのビルドにはWebKitGTKなどのシステムパッケージが必要です。

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Rustはrustup、Node.jsはNode.js 18以上を使用してください。

### 開発サーバー

```sh
npm install
npm run dev
```

デスクトップアプリとして起動する場合：

```sh
npm run tauri dev
```

フロントエンドをビルドし、Rustのテストを実行します。

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 現在の範囲

- X11のXRandRでアクティブなモニターを検出
- 複数のディレクトリからPNG/JPEG/WebPを読み込み（ディレクトリ内は再帰的に検索）
- 画像ディレクトリのドラッグ＆ドロップ追加
- モニターをクリックして割り当て先を選択
- `画面いっぱい`、`全体を表示`、`中央に原寸表示`をCanvasへ反映
- CanvasをPNG化してキャッシュへ保存し、Cinnamon/GNOME/MATEへ適用

選択した画像ディレクトリはアプリ内設定へ保存し、次回起動時に再読み込みします。

## 制限事項

- 画像はPNG/JPEG/WebPに対応しています。
- 画像は最大500枚、1ファイルあたり最大50 MiBまで読み込めます。
- 選択した画像ディレクトリは、アプリのローカル設定に絶対パスとして保存されます。
- Waylandは現在未対応です。
- 本ソフトウェアは現状有姿で提供され、動作や特定用途への適合を保証しません。

## ライセンス

PaperStichのコードはMIT Licenseで公開しています。詳細は[LICENSE](LICENSE)を参照してください。

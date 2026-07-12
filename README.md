# 中国語入門コース（ピンイン + 第1課）

静的サイトです。GitHub Pages にそのまま公開できます。

## 構成

```text
index.html                 ホーム
shared/site.css            共通スタイル
pinyin/
  pinyin.html              ピンイン練習
  pinyin.css
  sound/*.mp3              発音音声（使用分のみ）
lesson1/
  index.html               第1課
  styles.css / app.js / data.js
  assets/audio/            単語・本文の音声
  vendor/pinyin-pro.js
README.md / 使用方法.txt
```

## 使い方

1. ZIP を解凍して `index.html` を開く  
2. または GitHub Pages にルートごとアップロード  

推奨ローカル起動：

```bash
python -m http.server 8080
```

## 学習の流れ

1. ピンイン（音）  
2. 第1課：単語 → 本文 → 確認問題  

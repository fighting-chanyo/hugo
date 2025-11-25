require('dotenv').config();
const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

// 設定
const POSTS_DIR = 'content/post'; 
const STATE_FILE = 'state.json'; // 時間を記録するファイル

// 画像保存などのヘルパー関数（変更なし）
n2m.setCustomTransformer("paragraph", async (block) => {
  const { paragraph } = block;
  if (paragraph.rich_text.length === 0) return "<br>";
  return true;
});

const downloadImage = (url, savePath) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(savePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(savePath, () => {});
      reject(err);
    });
  });
};

(async () => {
  console.log('🚀 Notion同期を開始します...');

  // 今回の実行開始時間を記録（処理完了後にファイルに書き込む用）
  const currentRunTime = new Date().toISOString();

  // 強制全同期モードか判定
  const isFullSync = process.env.FORCE_FULL_SYNC === 'true';
  let lastSyncTime = null;

  // state.json から前回の時間を読み込む
  if (!isFullSync && fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      lastSyncTime = state.lastSyncTime;
      console.log(`🕒 前回の同期日時: ${lastSyncTime}`);
    } catch (e) {
      console.log('⚠️ state.json の読み込みに失敗しました。全件取得します。');
    }
  } else {
    console.log('🔥 全件取得モード（初回または強制）で実行します');
  }

  // フィルタ条件の作成
  const filter = {
    and: [
      {
        property: '公開',
        checkbox: { equals: true },
      }
    ],
  };

  // 前回の時間があれば、それ以降に更新された記事だけを取得
  if (lastSyncTime) {
    filter.and.push({
      timestamp: 'last_edited_time', 
      last_edited_time: {
        on_or_after: lastSyncTime,
      },
    });
  }

  // Notionから記事取得
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: filter,
  });

  console.log(`📝 ${response.results.length} 件の更新が見つかりました。`);

  if (response.results.length === 0) {
    console.log('💤 更新された記事はありませんでした。');
    // 更新がなくても、現在時刻だけは更新しておく（次回の検索範囲を狭めるため）
    // ※ここはお好みで。更新がないなら書き換えない運用もアリです。
    // 今回は「チェックした事実」を残すために書き換えます。
  }

  for (const page of response.results) {
    // --- ここから下は前回と同じ変換・保存処理 ---
    const props = page.properties;
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const title = titleProp?.title[0]?.plain_text || 'No Title';

    let slug = props['URLスラッグ']?.rich_text[0]?.plain_text;
    if (!slug) slug = title;
    slug = slug.replace(/[\\/:*?"<>|]/g, '-'); 
    
    const date = props['公開日時']?.date?.start || new Date().toISOString().split('T')[0];
    const tagsArray = props['タグ']?.multi_select?.map(tag => `"${tag.name}"`) || [];
    const tagsString = tagsArray.join(', ');
    const categoryName = props['カテゴリー']?.select?.name;
    const categoriesString = categoryName ? `"${categoryName}"` : '';
    const description = props['記事サブタイトル']?.rich_text[0]?.plain_text || '';

    console.log(`Processing: ${title} -> (Folder: ${slug})`);

    const articleDir = path.join(POSTS_DIR, slug);
    if (fs.existsSync(articleDir)) {
      fs.rmSync(articleDir, { recursive: true, force: true });
    }
    fs.mkdirSync(articleDir, { recursive: true });

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    let mdString = n2m.toMarkdownString(mdBlocks).parent;

    const imageRegex = /!\[(.*?)\]\((https?:\/\/.*?)\)/g;
    let match;
    let newMarkdown = mdString;
    
    while ((match = imageRegex.exec(mdString)) !== null) {
      const notionImageUrl = match[2];
      const ext = path.extname(new URL(notionImageUrl).pathname).split('?')[0] || '.png';
      const imageFileName = `img-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const savePath = path.join(articleDir, imageFileName);

      try {
        await downloadImage(notionImageUrl, savePath);
        newMarkdown = newMarkdown.replace(notionImageUrl, imageFileName);
      } catch (e) {
        console.error(`  ❌ Image Error: ${e.message}`);
      }
    }

    const frontMatter = `+++
author = "chanyo"
title = "${title}"
date = "${date}"
description = "${description}"
slug = "${slug}" 

categories = [
    ${categoriesString}
]
tags = [
    ${tagsString}
]
+++

`;
    fs.writeFileSync(path.join(articleDir, 'index.md'), frontMatter + newMarkdown);
    console.log(`✅ Saved: ${slug}/index.md`);
  }

  // ★最後に「今回の実行時間」をファイルに保存
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSyncTime: currentRunTime }, null, 2));
  console.log(`💾 次回用に時間を記録しました: ${currentRunTime}`);
  console.log('🎉 完了！');
})();
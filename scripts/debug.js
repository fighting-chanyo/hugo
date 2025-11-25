const { Client } = require('@notionhq/client');

console.log("----- 診断開始 -----");

// 1. 実際に読み込まれているバージョンを表示
try {
    const pkg = require('@notionhq/client/package.json');
    console.log("📦 Loaded Version:", pkg.version);
} catch (e) {
    console.log("📦 Version check failed");
}

// 2. クライアントの中身を解剖
const notion = new Client({ auth: "secret_dummy" }); // ダミー認証

if (notion.databases) {
    console.log("✅ notion.databases: 存在します");
    console.log("🔑 Keys in databases:", Object.keys(notion.databases));
    console.log("❓ Type of query:", typeof notion.databases.query);
} else {
    console.log("❌ notion.databases: undefined (存在しません)");
    console.log("🔑 Keys in notion:", Object.keys(notion));
}

console.log("----- 診断終了 -----");
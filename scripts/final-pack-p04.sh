#!/usr/bin/env bash
# P0-4 后最终双打包流水（9.9.9 夹具 → 1.3.0 正式）
set -e
cd /d/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer
git add CHANGELOG.md
git commit -m "docs(changelog): P0-4 主进程全量 fetch 安全化条目" | head -1
npm run build 2>&1 | tail -1
npm run build:desktop:main 2>&1 | tail -1
node tools/migrate-v127/build.mjs 2>&1 | tail -1
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='9.9.9'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
rm -rf desktop/release/*
npm run release:desktop 2>&1 | tail -2
cp desktop/release/kline-trainer-desktop-v9.9.9-windows-x64.exe desktop/release/latest.yml /d/tmp/accept-feed/
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='1.3.0'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
rm -rf desktop/release/*
npm run release:desktop 2>&1 | tail -2
echo FINAL_PACKAGED

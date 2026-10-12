#!/usr/bin/env bash
# 第三轮收尾双打包：9.9.10 NSIS 更新夹具 → 1.3.0 正式（均含 REC-HIST/GHOST/TYPEERROR 三修复）
set -e
cd /d/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer
npm run build 2>&1 | tail -1
npm run build:desktop:main 2>&1 | tail -1
node tools/migrate-v127/build.mjs 2>&1 | tail -1
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='9.9.10'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
rm -rf desktop/release2
export TRAINER_RELEASE_OUT_DIR=desktop/release2
npm run release:desktop 2>&1 | tail -2
mkdir -p /d/tmp/nsis-feed
cp desktop/release2/kline-trainer-desktop-setup-v9.9.10-windows-x64.exe desktop/release2/latest.yml /d/tmp/nsis-feed/
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='1.3.0'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
rm -rf desktop/release2
npm run release:desktop 2>&1 | tail -2
echo FINAL3_PACKAGED
ls desktop/release2/ | grep -vE "win-unpacked|builder-debug"

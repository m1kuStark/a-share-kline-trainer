#!/usr/bin/env bash
# P0-5 后最终双打包（绕开被锁的 desktop/release → desktop/release2）
set -e
cd /d/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer
rm -rf desktop/release2
export TRAINER_RELEASE_OUT_DIR=desktop/release2
npm run release:desktop 2>&1 | tail -2
cp desktop/release2/kline-trainer-desktop-v9.9.9-windows-x64.exe desktop/release2/latest.yml /d/tmp/accept-feed/
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='1.3.0'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
rm -rf desktop/release2
npm run release:desktop 2>&1 | tail -2
echo FINAL_PACKAGED_R2

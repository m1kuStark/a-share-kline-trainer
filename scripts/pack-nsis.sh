#!/usr/bin/env bash
# NSIS 单形态打包（INSTALL-01 后）
set -e
cd /d/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer
npm run build 2>&1 | tail -1
npm run build:desktop:main 2>&1 | tail -1
node tools/migrate-v127/build.mjs 2>&1 | tail -1
rm -rf desktop/release2
export TRAINER_RELEASE_OUT_DIR=desktop/release2
npm run release:desktop 2>&1 | tail -3
echo NSIS_PACKAGED_OK
ls desktop/release2/ | grep -vE "win-unpacked|builder-debug"

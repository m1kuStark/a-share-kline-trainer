#!/usr/bin/env bash
set -e
cd /d/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer
TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/m4-history.spec.ts e2e/archive-recording.spec.ts 2>&1 | tail -8
echo JOURNEY3_DONE

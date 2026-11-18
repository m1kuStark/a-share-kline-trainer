# 录制 gzip 排空修复证据

本目录的[证据ZIP](M9-recording-drain-evidence.zip)保存原失败、真实原生解压器对照、单测RED/GREEN及两年录制导入回放。SHA256为`1720c52c46d20838bd1f256ce4a7ec88fc9d7ef098895d6a7c7b656bfe942685`。[原始索引](archive-index.md)中的路径均为ZIP成员；[清单](manifest.json)及[独立解包收据](archive-verification.receipt.json)验证96成员、95项manifest和56项事实检查。

原相关旅程18通过、1失败，浏览器JSON截断；同一磁盘gzip完整。原生解压器在明确注入读调度后复现先cancel丢尾，未注入探针可通过，不能声称精确重放了原时序。新单测RED丢末尾123字节，正常draining后清理的最小修复使文件/合并包44项通过；实际两年Journey原生0，483步、974事件、975检查点，导入374ms，恢复完整，无pageerror。

[独立审查](final-review.md)C0/I0/M0，仅批准该修复范围；[审查收据](final-review.receipt.json)保留指纹与边界。主代理已查看实际回放截图：末日483/483、账户/操作和主副图正常显示。该项定向绿不替代完整候选、同提交Windows包或用户验收。

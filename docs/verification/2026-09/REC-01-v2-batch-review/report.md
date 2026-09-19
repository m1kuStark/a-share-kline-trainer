# REC v2并行批次验收

2026-09-19。第一批三个GLM均已交付，主代理分别重新测试和审查。结果：codec通过并合入；validator与storage需精确返修，不因自报测试全绿而合入。

## Codec通过

2f2f95b修复恢复内容索引、真实链深、未知截止→已知截止31层回退、指纹仅保存引用、A→B→A复用。根25/25codec测试、web类型通过；四组冻结600519/gbbq共3844检查点顺序与逆序抽样还原深等，包含两年、四除权日及周/月观察。结果见[result.json](result.json)。合并1a2078a后codec/core/replay合计65/65与类型检查通过。

这证明纯格式还原正确，不等于页面已用紧凑存储；应用仍v1，后续必须迁移并执行新Journey。

## Validator需修正

e4858c6为隔离审查基线，未合入。新25＋旧58=83/83通过，但四个独立畸形输入探针被错误接受：基础firstCheckpoint晚于派生；checkpoint日周期引用月资源；500图形基础+增量1个还原501；20000bars基础+增量1个还原20001。已向GLM派精确回归修正，不改公开类型或文件API。

## Storage需修正

de3f4e2为隔离审查基线，未合入。19/19单测、类型通过。根用真实Edge独立浏览器上下文及其真实IndexedDB执行save/load、追加、双实例等长不同事件冲突，均符合预期。header冲突未通过：同revision两实例各修改app.version为left/right，第二个save错误成功，持久值仍left。原因batchId未包含全部header，采纳分支只比较记录行。

已派修复：批次包括完整header身份并逐字段比较；load按header.counts验证kind/index连续性，拒绝静默缺行；Memory保存header副本，避免未保存的gap变更污染持久镜像。后三项的新增失败回归由返修任务提供。

浏览器探针`verify-compact-idb.cjs`在全局Headroom缓存，esbuild只将storage模块打包到隔离测试页，不改变训练器页面、TDX或个人SQLite。输出为roundtrip/append/contentConflict=true、metadataConflict=false、persistedVersion=left，作为需修复证据，未虚报验收通过。

## 第二批与长期回归

三个独立工作树并行：validator返修、storage返修、gzip文件封装；文件分支继承validator公开API和codec已验收提交，禁止越界修validator，最终合入修正后联合验收。

新增[两年Journey](../../../../e2e/recording-long.spec.ts)：开局先验gzip magic/schema2，之后实际按钮推进>450日、真实买卖/T+1拒单/绘图/周期切换/刷新，末尾比较账户/成交/图形并逐检查点查未来行情，断后端导入回放，保存体积/耗时证据。当前v1尚未接新格式，run-d201e945-4a40-4e19-ac0a-46d50a11029a按预期RED：收到JSON开头123/34，不是gzip31/139；尚未执行后续两年长循环。不能把用例已写当作两年验收通过。

旧recording.spec通过测试侧magic解码helper兼容v1/v2，浏览器导入仍走产品自己的验证。run-5e66e772-772f-40e7-aabe-e8bb5a44347e重新执行4/4通过、退出0。下次v2接线必须让两年用例GREEN，再跑全量candidate门禁，不能跳过或降低正常两年支持。

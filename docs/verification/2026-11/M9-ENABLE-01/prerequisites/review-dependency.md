# DEP-SEC-MINIMATCH-01 独立只读审查

审查日期：2026-11-18。裁决：**可合入此本地依赖候选**。Critical 0 / Important 0 / Minor 0。主任务仍需完成全局文档、状态与门禁对账；本裁决不代表整版验收、远端告警关闭或发布。

审查对象是 `task/DEP-SEC-MINIMATCH-01` 当前工作树相对 base `2c66477f0c4875ac3a100338fdbc42b4878dadd8` 的固定候选：
- package.json SHA256 `cf1cdf0504cda7145d4b449a82a500c093eeec2d46610ec043430e55d32643b7`
- package-lock.json SHA256 `b6f5c55b431f92f98b14df1ef06132fb95500d6236bb803823b6a64fc12ef62d`
- result.json SHA256 `d687cdfe06f72631260b3f01033a2ac16915eb4668cf5c345016ba4dbd066472`

审查者未运行安装、测试、构建、打包、产品或包探针；只读 Git diff、源码、现有收据与实际产物字节，报告仅写入 Codex headroom-cache。

## 五维核查

1. **计划对齐**。package.json:74-78 的 override 同时限定父包版本和原始 child 请求范围。独立逐包比较 base/current lock，恰好三条 minimatch 记录变化：app-builder-lib 10.2.6→11.0.9、universal 9.0.9→11.0.9、生产 glob 11.0.5→11.0.9。四条 legacy（asar/dir-compare/rimraf 3.1.5、filelist 5.1.9）与其余依赖保持原样，没有扩大 Dependabot major 策略。上游补充依赖记录已存在，未增加或删除其他包。

2. **代码质量**。仅依赖选择、锁与本任务文档/验证证据变化；没有产品代码、测试断言或 skip 的改动。选择器收窄避免此前 npm 跨层覆盖污染 legacy。新增 minimatch Node 范围20||>=22满足项目>=24；universal 旧副本的ISC→BlueOak许可元数据变化已可见。升级父包后需重新评估 override，任务文档已明确。

3. **架构与集成**。读取实际安装消费者和11.0.9实现/类型：builder 的 FileMatcher 构造 Minimatch、读取 .set、使用 .match(path,partial) 均保留；universal 的 CJS/ESM named minimatch 与 matchBase 保留；glob 的 Minimatch/GLOBSTAR/escape/unescape、.globParts/.set/.hasMagic 保留。server/src/index.ts:98 默认 wildcard 静态服务，@fastify/static 的 glob枚举仅在 wildcard=false 分支，未证明攻击者可控制 glob。包内探针从 app.asar 的 createRequire 解析真实生产模块，并由真实 packaged Electron 执行；没有从开发 node_modules 冒充包内运行。

4. **测试真实性**。基线 lock guard native1，四项因三旧版本/两公告范围准确失败；基线 installed guard native1，13项合法控制通过、7项版本/范围失败。最终 installed guard native0，20/20通过，含实际electron-builder.yml模式、包含/排除、partial目录、dotfiles、Windows路径、.set和matchBase正反例；另legacy4项和公开Node/ESM3项通过。正式最终 npm test native0，188+34文件、2654+369=3023项，无跳过；build0、portable0、NSIS x640。早期0xC0000409、ELSPROBLEMS、下载超时、ASAR路径/生成配置假设错误和未等待GUI的exit=null均保留。未把这些失败算成通过，也未使用局部重跑拼接全量结果。

5. **harness收据**。result.json 的37条原生命令收据及134项artifact索引逐个核对路径、bytes和SHA256，全部吻合；6份明文辅助文件/属性与128份可逆raw.b64收据完整归档。128份Base64逐个解码后bytes/SHA256与原缓存全部相同，没有缺项或重复decoded路径；正常whitespace检查保持启用，git diff --cached --check独立复核native0。守卫/探针源码可从映射恢复，解码helper验证encoded/decoded双指纹后写入显式绝对目录且拒绝覆盖不同内容。重新计算app.asar、NSIS、portable三个真实产物SHA，与清单一致。desktop-app strict明确native3（31covered/10planned/RED0），没有宣称整表通过；抽查DESKTOP-APP-URL及DESKTOP-SERVER-ENTRY-PROGRAMMATIC绑定源文件存在，未因本审查另跑vitest list。全局docs/status/impact失败及归属均保留给集成人。

## 两条公告的边界

GHSA-g3hv-75wg-m249 的范围是>=7.0.0,<11.0.1，修复11.0.1；GHSA-hqmv-qgp3-jx75 的范围是11.0.3–11.0.7，头部修复11.0.8，正文仍有过时无补丁措辞。生产旧11.0.5只落在后者，不能以旧告警或production audit基线0遗漏它。11.0.9避开两范围，核查来自本任务归档的上游原始公告。版本暴露与产品可利用性在文档中分别表述，未执行资源耗尽PoC。

## 实际包核验与明确限制

- NSIS `f8a890cdd2d11c72af283497b80ee1aabec2b1a10c1783a28b855b28fe0bfcde`；portable `312b4dff58f71b1c1a492bf79b0b2e9d901fc0022f246173ebe593376a21dfca`；app.asar `8333463b41266a8f6306b7b2727f6d65609992b21a21571a00beeda26ec56639`。
- 包清单6219文件，生产仅minimatch11.0.9；最终等待式包探针native0/signal=null，Electron44.10.2，glob4文件，index与JS200、missing404、内存SQLite roundtrip通过。ELECTRON_RUN_AS_NODE模块探针没有覆盖完整桌面启动或可见窗口。
- migration-export-inline.html 本树构建字节与包内字节一致，和HEAD Git blob仅换行差异，独立canonical blob核对相同；没有把它当作越界产品变更。
- 目录中的初始失败、修正后的验证准备和原始脚本一起保留；生成app-update.yml按builder feed/cache语义校验，没有强制要求它等于fallback文件字节。

## 问题与搁置不判

未发现需修改的代码、兼容性或证据真实性问题。

搁置不判：产品可利用性/耗尽攻击、macOS universal实际打包、NSIS安装向导与卸载、完整UI/用户验收、根集成提交的最终验收ZIP、远端告警关闭/PR/发布。原因分别是未经执行或由主任务/用户拥有；本次模块与打包证据不能替代这些行为。现有maxTries重复键警告、desktop-app整表未闭合和build:desktop强制portable为已披露的既有维护项，不在本依赖候选中顺带修改。

## 最终存储复核

主任务否决了 -whitespace 提议，worker已撤回；最终.gitattributes仅定义LF文本，未放宽检查。最终固定result为d687cdfe06f72631260b3f01033a2ac16915eb4668cf5c345016ba4dbd066472；134项全部复核、其中128项与原cache逐字恢复一致。package/lock冻结指纹未变。由此本报告再次给出可合入裁决，C0/I0/M0。候选正常hook签名提交为f493364bdefb2165f36cf4924cd983ab98842592；独立git verify-commit native0、%G?=G、porcelain为空。未重复产品测试。


最终提交身份附录：2026-11-18 独立核验 commit f493364bdefb2165f36cf4924cd983ab98842592，ED25519签名有效，工作树干净，result仍为d687cdfe...。冗余1158738字节CRLF格式诊断留原缓存，以externalEvidence的SHA26a4ded7e32ca145cf902418c2aefc5531ebeb0120129e465ebe7ab415344a37关联，实际字节已核验；正常hook原ENOBUFS失败也保留，未放宽hook。其余产品验证收据均在库。最终134artifact、128可逆收据与原缓存全部一致，源package/lock/helpers不变。

独立commit字节复核：直接git show f493364:每个artifact，134项存储字节/128项decoded双指纹全部吻合；37条command（包括最终hook失败收据）。详情见同目录committed-byte-review.json。

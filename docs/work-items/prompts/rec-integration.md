# REC-INTEGRATE（先等待核心/图表/回放分支已合入）

你是GLM开发Agent，主代理验收。先读根/模块AGENTS、docs/engineering/recording-contract.md以及实际recording模块和图表/回放接口。只写web/src/App.vue、web/src/views/Launcher.vue、Training.vue、web/src/api.ts、web/src/recording/session.ts（或useRecording.ts）、web/src/styles.css（只新增录制样式）、server/src/api.ts（只注册已实现recording-context路由）、server/test/recording-integration.test.ts、docs/specs/recording.md。不要改其他模块的核心实现，发现接口缺口列出来；不git提交/合并/push，不运行全量Journey或真实DB。

目标：用户能使用默认录制、暂停恢复、导出文件、导入并只读回放。重点完整可用，保持图表布局与旧逻辑。新控件紧凑固定空间，主页有'记录操作'默认勾选；训练有role=status显示'正在记录'/'已暂停记录'/'记录失败'，开关'记录操作'（忙碌时disabled）、'导出录制'。主页有'导入录制'文件输入按钮，最近本机录制列表可继续查看/导出，避免训练结束后丢入口。状态与错误不能被普通训练message覆盖。

App持有本场enabled选择（每次新建默认true，本场暂停不要写成全局默认）；Launcher created事件可带recordingEnabled，但保留App.refresh与旧测试有效。Training进入后等待当前行情、画线和只读recording-context加载成功，创建或恢复与training id+createdAt关联的Recorder。用sessionStorage绑定本标签页sessionId，多标签创建独立日志；刷新恢复paused状态及未完成事件。旧训练标明从当前状态开始录制，不伪造过去动作。新训练创建可携带创建请求时间/参数，在确定版本后补记创建意图与结果，或明确本首批录制从创建成功进入训练开始（不要伪造时间）。

api request改抛ApiError保留status，保持原中文message和现有调用兼容；context fetch纯GET，不访问普通/api/kline。app元数据从context响应保存，未知时显示明确错误/未知，不读本机secret。

CheckpointInput来自当前TrainingSnapshot、chartRef.captureState（完整已载历史）、ui(theme/tool/magnet/multiSelect)、context规则/权息。完整响应采用后（loadVersion检查通过）才记录chart.load。trade/advance/settle API成功立刻finish accepted，再独立load事件；后续加载失败不能改为交易失败。4xx拒绝为rejected，网络不明unknown/failed，绝不自动重发交易。params保存side/weight/shares，行情推进后新context与新chart快照不能附到前一个时间状态。chart operation回调以当前快照begin/finish；chartCapture节流并保留最后视窗，避免render loop/每像素全量存储。

暂停时先等当前domain命令结束，capture当前checkpoint后pause；暂停期间不记录业务，恢复必须新segment全状态。UI不要因为录制故障阻止用户交易，但必须常驻故障提示，导出不得声称落盘成功。保存drawings的结果另记drawings.save；theme变化单独记录。关页仅尽力flush，不能承诺浏览器关闭前异步必完成。

导出 await recorder.export() 后使用exportRecording、Blob下载.trainer-session.json；文件默认不包含绝对路径。导入先readFile大小<=25MiB再parseRecording，失败中文可见，不进入Replay。Replay是独立视图/Modal，不引用Training或交易热键，不覆盖活动训练，关闭返回原状态。导入期间可以保留当前训练组件被隐藏还是卸载要明确处理flush；首批允许只在首页导入避免中途丢草稿。最近录制从IndexedDB.load→validate→只读回放。

遵循类型契约，不用大量as any逃避。尽量将录制逻辑封装在session composable，页面只挂动作。先补必要回归测试，再实现；跑定向单测和npm run typecheck:web、npm run build:server。对旧源码契约失败不得删除断言，说明情况主代理处理。返回完整差异和测试，完成即停止。

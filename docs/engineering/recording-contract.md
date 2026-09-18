# REC-01 共享接口合同

本批以web/src/recording/types.ts为公共类型。跨文件import只用类型，不将服务端SQL实现耦入浏览器。schemaVersion=1，format=trainer-session。

## 类型

JsonValue 为有限JSON递归类型。Action 是明确白名单：training.create/advance/trade/settle/abandon，chart.load/timeframe/viewport/tool/drawing.create/drawing.edit/drawing.move/drawing.delete/drawing.undo/drawing.redo/drawing.cancel/drawing.clear，drawings.save，ui.theme，recording.pause/resume，session.interrupted。

RecordingEvent：seq（严格从1递增）、opId、segmentId、elapsedMs、phase started/finished、action、source ui/keyboard/chart/system、params?:JsonValue、outcome?:accepted/rejected/failed/cancelled/interrupted/unknown、result?:JsonValue、checkpointId?:string。

ChartCapture：timeframe:1D/1W/1M、bars:Bar[]（当前可见边界内已加载数据）、drawings:Drawing[]、view:{fromTimestamp:number|null,toTimestamp:number|null,barSpace:number,paneHeights:Record<string,number>}、costPrice:number|null。Bar复用web/src/api.ts公开类型，Drawing复用drawingState.ts。快照不可跨推进日覆盖去重。

RecordingCheckpoint：id、afterSeq、segmentId、capturedAt、training:TrainingSnapshot|null、chart:ChartCapture|null、ui:{theme:string,tool:string|null,magnet:string,multiSelect:boolean}、context:JsonValue|null。context只声明实际观察到的规则与权息，不伪称创建时规则冻结。

RecordingFile：format、schemaVersion、sessionId、createdAt、app:{version,gitCommit,dirty,chartLibrary}、environment:{timezone,viewport:{width,height},dpr}、trainingKey:string|null、events、checkpoints、gaps:Array<{afterSeq:number,resumedAtSeq:number|null}>、complete:boolean。所有必要图表数据内嵌于检查点；输出不得包含未来bars或任意外部引用。

## 核心接口

validateRecording(value:unknown):RecordingFile 抛中文可行动错误，验证最大25MiB（parse入口）、50000事件、2000检查点、bars/points/有限数值、版本、动作、序号、opId/phase、checkpoint引用、ID唯一与格式。parseRecording(text):RecordingFile；exportRecording(file):string。

Recorder(storage, options)；options:{app,environment,onChange?:(status)=>void}。storage接口save(file):Promise<void>/load(id):Promise<RecordingFile|null>/list():Promise<RecordingSummary[]>，生产IndexedDB实现、测试内存实现。status:{state:'recording'|'paused'|'error',error:string|null,eventCount:number,sessionId:string}。

start(trainingKey:string|null, initial:CheckpointInput, enabled=true):Promise<void>；begin(action,params?,source?):string|null；finish(opId,outcome,result?,checkpoint?:CheckpointInput):void；capture(checkpoint:CheckpointInput):void；pause(checkpoint):Promise<void>；resume(checkpoint):Promise<void>；flush():Promise<void>；export():Promise<RecordingFile>；restore(id):Promise<void>；getStatus()；getFile():RecordingFile（深拷贝）。CheckpointInput为checkpoint除id/afterSeq/segmentId/capturedAt。存储顺序串行，出现错误onChange立即报错；恢复悬空started追加interrupted，不猜测请求结果。暂停期间begin返回null，恢复新segment保存状态并闭合gap。

## 图表接口

KlineChart新增可选readOnly=false；新增emit operation:{action:Action,params?:JsonValue}，chartCapture:ChartCapture。expose captureState():ChartCapture。readOnly保留导航/缩放，但禁绘图、编辑、删除、undo/redo和绘图恢复后的自动保存事件。捕获完整loadedData、不可变复制、语义窗格；高频视窗事件节流到手势结束或150ms。

## 回放接口

SessionReplay.vue props:{recording:RecordingFile} emit close:[]。单独只读图表，不引用Training及交易API。按checkpoint数据集显示，不调用TDX；事件列表支持选步、播放/暂停、倍速、暂停录制缺口提示。组件不改App，集成人接入。

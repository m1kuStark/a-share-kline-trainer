# REC-V2-FILE：gzip文件封装独立任务

GLM5.3Flash最高档。工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-FILE-V2，基于e4858c6 validator审查版加2f2f95b已验收codec。validator另一个Agent正修4边界但API冻结；你只开发文件封装，不改validator/codec/types、不迁就其缺陷。允许recordingFile.ts、recording-file.md、server/test/recording-file.test.ts。读根/web/server规则及v2合同。不Git操作、不package、页面、个人数据、TDX、浏览器、子agent。

readRecordingFile(blob:Blob):Promise<CompactRecordingFile> 根据前两字节1f8b识别gzip，支持v1 JSON→validateRecording(value,{maxCheckpoints:20000})→compactRecording→validateCompactRecording，以及v2明文/gzip。未知schema拒绝，不能只cast。writeRecordingFile(file,compressed=true):Promise<Blob>校验再默认gzip JSON v2，false可读JSON。扩展名调用方设.trainer-session.json.gz。使用浏览器CompressionStream/DecompressionStream（node24同API测试），无Node fs/zlib进生产代码，不新依赖。

预算：gzip输入<=25MiB；明文/解压外层<=256MiB供旧v1兼容；判定v2后<=128MiB；解压逐chunk计数字节，越界立即cancel，不先arrayBuffer完整解压后判断。明文blob.size先拦；gzip不信文件extension/MIME。UTF8解码用fatal模式，不把损坏字节替换后误接受；JSON/压缩流异常中文可行动错误。write输出压缩输入也须能被同read接受；不能产生自己无法读取的文件。固定预算可export常量，测试允许纯内部stream helper注入更小阈值以省内存，但public入口不能信录制文件自报预算。

先失败测试：真实Blob gzip压缩解压逐checkpoint深等(小fixture用实际codec/validator)，unicode、v1迁移（>2000cp仍<=20000）保持旧数据、未压缩v2、magic与后缀无关、截断gzip/JSON、未知schema、NaN export失败、压缩与解压不同预算、超过预算取消reader的证据；不要真造巨量内存测试，选有效流helper低阈值。不要读原个人录制数据，可复用测试fixture。
npm test -- server/test/recording-file.test.ts --maxWorkers=2；typecheck:web。若validator已知缺陷阻碍测试，报告而不是越界改它。完成短报并停止。

# REC-V2-FILE 精确返修：高压缩率解压取消死锁

GLM5.3Flash最高档，工作树REC-FILE-V2，基线5fd5e59（已合c1504ee校验修正）。只改recordingFile.ts、recording-file.test.ts和recording-file.md。不改codec/validator/types/包/UI/其他工作树/Git，不个人数据/浏览器。

16测试和types绿，但根独立review发现P1：输出draining发现越界后抛错停止读，主循环仍await writer.write；背压等待读取，后续cancel永远到不了，导致导入挂死。最小复现仅65字节gzip：inflateGzipWithBudget(new Blob([gzipSync(Buffer.alloc(32768,65))]).stream(),64) 超750ms不settle。65536、1MiB原文同样，16384正常拒绝。

先补有效失败测试（Promise.race超时明确失败并清理，不让Vitest进程悬挂）。输出端发现预算超限/解压异常时立即触发sourceReader.cancel、outReader.cancel和writer.abort，使等待中的write被打断；避免顺序await abort又等另一端造成死锁。错误优先级保持预算错误、无unhandled rejection，不丢成功输出。标准API可用pipeThrough但需证明取消真的及时；不用自写压缩算法。

回归高压缩率多输出chunk+预算、原随机多块cancel例、1MiB正常gzip按1/16/16384/65536/1MiB输入块往返、截断gzip拒绝。不要增其他功能。npm test -- server/test/recording-file.test.ts --maxWorkers=2；typecheck。返回短报后停，根再跑浏览器验收。

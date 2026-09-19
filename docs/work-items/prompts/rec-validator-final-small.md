主代理已定位9个失败原因，不要重新调查/思考整个校验器。仅改validation.ts与recording-validation.test.ts，清理你创建的zz-probe.test.ts。
1 测试helper fileWithChart（约523行）只return makeFile，没有调用validateRecording；后面大量expectFail(()=>fileWithChart(...))只构造数据当然不会抛。把helper改为 return validateRecording(makeFile(...))，这是必要测试修复，不改测试期望。
2 环境viewport.width/height/dpr仍用assertFinite，改assertPositive。
3 gap测试第一accept case事件只有4条却gap.resumedAtSeq=6；把该case事件扩成6或8条makeBulkEvents，checkpoint引用修好。overlap测试同样须先保证范围内才能测试重叠。错误关键字最后/末尾统一即可。
4 npm test -- server/test/recording-validation.test.ts，处理剩余具体失败，npm run typecheck:web。
别扩展功能；不要git提交；代码文件已有主要修复，不要推倒重写。完成即退出。请尽快直接Edit这些行。

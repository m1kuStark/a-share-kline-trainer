# v0.3.2 首批开发合同

2026-09-23，用户授权按[批次计划](../proposals/first-use-batch.md)开发、验收并公开发布v0.3.2。集成入口[REL-03](../work-items/tasks/REL-03.md)。这里只冻结首批三个纯模块合同，后续接线另分小任务；模块通过不代表产品交付。

## FRESH-01：新鲜度

文件server/src/data/freshness.ts（纯函数，不读取文件/网络/环境，不改refresh）。导出：

```ts
export interface TradingCalendar {
  id: string; from: string; through: string; closedDates: readonly string[]
}
export interface FreshnessInput { now: Date; sourceMaxDate: string | null; calendar?: TradingCalendar }
export interface FreshnessResult {
  state: 'current' | 'stale' | 'unknown'; expectedDate: string | null
  sourceMaxDate: string | null; checkedAt: string; reason: string
}
export function shanghaiDate(now: Date): string
export function assessFreshness(input: FreshnessInput): FreshnessResult
```

日历定义范围内周一至周五为开市日，closedDates为正式休市；只信调用方提供的完整日历，from/through之外不能推算成已知。上海15:00之前查前一已收盘交易日，之后包含当日；主机时区不参与计算。日历无效/缺失/不足、日期格式或排序问题要保守unknown；非法Date入参抛明确错误。sourceMaxDate为空或晚于上海系统日unknown，不能给绿色current。可信expectedDate且sourceMaxDate>=expectedDate才current；小于则stale。reason必须明确来源末日并不证明所有股票完整。模块测试用合成休市表，不能假装测试日历就是官方日历。集成人另核实并登记发布日历的来源/范围；取不到可信日历时保守unknown而非周中恒为交易日。

## TDX-CHECK-01：候选诊断

文件server/src/tdx/inspect.ts；暂不改现有discover、launcher或API。只对调用方给定的本地候选根目录和固定结构作只读检查，不扫描驱动器/注册表/进程，不写TDX，不读取账号。导出：

```ts
export interface TdxCandidateCheck {
  root: string; recognized: boolean; readable: boolean
  dailyFileCount: number; latestDate: string | null
  hasAdjustment: boolean; hasNames: boolean; hasBenchmark: boolean
  problems: string[]
}
export function inspectTdxCandidate(root: string): Promise<TdxCandidateCheck>
export function inspectTdxCandidates(roots: readonly string[]): Promise<TdxCandidateCheck[]>
```

候选规范化/去重，Windows忽略路径大小写，其他系统保留区分。不跟随symlink/junction，拒绝UNC/设备路径；拒绝相对或空路径，返回可行动的problems，不猜测选目录。根可访问但没行情与根不存在/无权限分别报告。recognized需存在vipdoc或T0002/hq_cache等结构证据，不能只凭目录名称；空安装可识别但不可宣称可训练。只检查sh/sz/bj的lday及固定hq_cache文件；名称/基准检查可复用项目已有实际文件名，分别给状态。

dailyFileCount仅统计符合现有A股代码口径且格式有效的.day。用文件长度为32倍数和末记录校验日期，有限读取首/末记录，不读行情全文；坏文件不抛整个进程，problems注明检查不完整；latestDate仅在成功检查的数据里取最大，不代表目录完整。读取前后stat不一致应有限重试或报“文件正在更新”，不得无限等待。hasAdjustment只能说明文件存在且可读，不冒充解码成功；空gbbq不可用。权限和I/O失败不能伪装成未安装。内部简单并发或串行，避免同时打开数千句柄。用临时合成文件测试，不能读用户目录。

## RANGE-01：训练范围

文件server/src/train/range.ts（仅纯函数，不导入engine、不读取价格/文件）。导出：

```ts
export type TrainingRangeRequest =
  | { mode: 'preset'; startDate: string; months: 1|3|6|12|24; endDate?: string }
  | { mode: 'latest'; startDate: string }
  | { mode: 'bars'; startDate: string; count: number }
export interface TrainingRangeInput {
  request: TrainingRangeRequest; dates: readonly string[]; today: string
  knownClosedDates?: readonly string[]
}
export type TrainingRangeResult =
  | { ok: true; mode: TrainingRangeRequest['mode']; requestedStart: string; requestedEnd: string | null;
      startDate: string; endDate: string; barCount: number; notes: string[] }
  | { ok: false; code: 'INVALID_INPUT'|'NO_DATA'|'BEFORE_HISTORY'|'AFTER_DATA'|'INSUFFICIENT_DATA'|'UNCONFIRMED_COVERAGE'; message: string }
export function presetDates(today: string, months: 1|3|6|12|24): { startDate: string; endDate: string }
export function planTrainingRange(input: TrainingRangeInput): TrainingRangeResult
```

dates必须有效、唯一、升序且<=today；上层负责剔除盘中未完整日线。presetDates使用自然月减法并裁月末，返回固定today终点。preset请求显式endDate用于系统日期回推（禁止endDate早于startDate或晚于today）；未给则按startDate加月。首根>=请求起点，末根<=终点，首根对齐后不重新加月。请求早于本地first返回BEFORE_HISTORY而不是声称早于上市。尾部欠缺若全是周末或knownClosedDates才允许取末根；含未证实工作日返回UNCONFIRMED_COVERAGE；请求终点晚于today返回INSUFFICIENT_DATA。内部缺口不能凭日期断言停牌/完整，成功notes注明仅按现有日线计算。

latest固定为dates最后一根；bars取从首根起N根，包含首根、不含观察区，N=1成功；非法N或数据不足明确失败，不能截短。自定义没有任意两年/条数上限，必须正安全整数且不超过可用量。异常形状从JS调用也不可静默成功。月份、闰年、周末、假日、早于历史、未来、N边界均独立测试。新老数据库/录制格式接线由后续任务完成，worker不扩大枚举或改交易规则。

## 共同交付

每路仅实现自己的一个模块、一个测试和自己任务卡；根代理维护共享API/DB/App/包版本/锁文件。先运行失败回归，再实现，定向单测与build:server通过；报告命令/退出码与限制。Mimosa如拦截停在原现场交给集成人，不绕过。Prompt：[FRESH-01](prompts/REL-03/FRESH-01.md)、[TDX-CHECK-01](prompts/REL-03/TDX-CHECK-01.md)、[RANGE-01](prompts/REL-03/RANGE-01.md)；后续[本机控制接线设计](release-032-control-design.md)。最高思考档、1M配置、最多3并发；集成人独立审查后串行合入REL-03，不复制全仓文档进上下文。

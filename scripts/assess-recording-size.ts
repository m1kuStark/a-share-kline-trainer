import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readDayFile } from '../server/src/tdx/dayfile.ts'
import { TRAINING_LOAD_BARS } from '../server/src/train/engine.ts'
import { Recorder } from '../web/src/recording/recorder.ts'
import { exportRecording } from '../web/src/recording/validation.ts'

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Pass the frozen sh600519.day fixture path; do not use a personal training database')
  const bars = await readDayFile(input)
  const start = bars.findIndex(bar => bar.date >= '2024-09-16')
  const end = bars.findLastIndex(bar => bar.date <= '2026-09-16')
  const rows = []
  let oneCopy = 0, twoCopies = 0, crosses = null
  for (let i = start; i <= end; i++) {
    const n = Buffer.byteLength(JSON.stringify(bars.slice(Math.max(0, i + 1 - TRAINING_LOAD_BARS), i + 1)))
    oneCopy += n
    twoCopies += n * 2
    if (!crosses && twoCopies > 25 * 1024 * 1024) crosses = { date: bars[i].date, steps: i - start }
    const steps = i - start
    if ([20, 60, 120, 240, end-start].includes(steps)) rows.push({ advanceSteps: steps, date: bars[i].date, chartCopiesPerStep: 2, chartArrayBytes: twoCopies, chartArrayMiB: +(twoCopies / 1048576).toFixed(2), checkpointsEstimate: 1 + steps * 3, eventsEstimate: steps * 4 })
  }
  // Exercise the real recorder/exporter on the current schema. Storage is a no-op benchmark;
  // no IndexedDB, personal SQLite, transaction engine or API mutations.
  const recorder = new Recorder({ save: async () => {}, load: async () => null, list: async () => [] }, {
    app: { version:'0.1.0',gitCommit:'assessment',dirty:true,chartLibrary:'10.0.3' },
    environment: {timezone:'Asia/Shanghai',viewport:{width:1280,height:900},dpr:1},
  })
  const checkpoint = (index: number, includeChart = true) => {
    const data = bars.slice(index + 1 - TRAINING_LOAD_BARS, index + 1)
    return { training: {training:{id:1,tier:'2Y' as const,code:'600519',name:'贵州茅台',market:'sh',startDate:bars[start].date,plannedEnd:'2026-09-18',currentDate:bars[index].date,status:'running' as const,settleDate:null,earlySettle:false,blind:false,adjustMode:'raw' as const,initialCash:1000000,createdAt:'2026-09-19T00:00:00.000Z'},account:{cash:1000000,shares:0,availableShares:0,costPrice:null,marketValue:0,equity:1000000},trades:[]},chart:includeChart?{timeframe:'1D' as const,bars:data,drawings:[],view:{fromTimestamp:Date.parse(data[0].date),toTimestamp:Date.parse(data.at(-1)!.date),barSpace:8,paneHeights:{candle_pane:400,VOL:120,MACD:120}},costPrice:null}:null,ui:{theme:'dark',tool:null,magnet:'weak_magnet',multiSelect:false},context:null }
  }
  await recorder.start('assessment', checkpoint(start))
  const sampleSteps = 120
  for (let i = start + 1; i <= start + sampleSteps; i++) {
    recorder.finish(recorder.begin('training.advance')!, 'accepted', null, checkpoint(i,false))
    recorder.finish(recorder.begin('chart.load')!, 'accepted', null, checkpoint(i))
    recorder.capture(checkpoint(i))
  }
  await recorder.flush()
  const file = recorder.getFile()
  let exportResult = 'passed'
  try { exportRecording(file) } catch (error) { exportResult = String(error) }
  const result = {kind:'recording-size-assessment',source:{path:input,sha256:createHash('sha256').update(await readFile(input)).digest('hex'),stock:'600519',from:bars[start].date,to:bars[end].date,loadedBars:TRAINING_LOAD_BARS,advanceSteps:end-start},assumptions:['raw OHLC frozen sample','daily advance only; no trades, drawings, viewport interaction or additional history','one null-chart checkpoint and two full-chart checkpoints per advance from current Training/useRecording wiring','not a measured browser journey or IndexedDB performance benchmark'],estimates:rows,twoYearOneCopyChartMiB:+(oneCopy/1048576).toFixed(2),twoYearTwoCopiesChartMiB:+(twoCopies/1048576).toFixed(2),chartBytesCross25MiB:crosses,uniqueObservedBars:end-start+TRAINING_LOAD_BARS,rawSingleUnionMiB:+(Buffer.byteLength(JSON.stringify(bars.slice(start+1-TRAINING_LOAD_BARS,end+1)))/1048576).toFixed(3),realRecorderProbe:{advanceSteps:sampleSteps,events:file.events.length,checkpoints:file.checkpoints.length,jsonMiB:+(Buffer.byteLength(JSON.stringify(file))/1048576).toFixed(2),exportResult}}
  if (process.argv[3]) await writeFile(process.argv[3],JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}
main().catch(error => {console.error(error);process.exitCode=1})

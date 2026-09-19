// Offline format experiment only. Never imported by the application or used to mutate TDX/SQLite.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { strict as assert } from 'node:assert'
import { performance } from 'node:perf_hooks'
import { readDayFile, type DayBar } from '../server/src/tdx/dayfile.ts'
import { readGbbqFile, applyForwardAdjustment, type AdjustmentEvent } from '../server/src/tdx/gbbq.ts'
import { aggregateBars, type Timeframe } from '../server/src/tdx/kline.ts'
import type { RecordingFile, RecordingCheckpoint, ChartCapture } from '../web/src/recording/types.ts'
import { validateRecording } from '../web/src/recording/validation.ts'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type SeriesVersion = { id: string; timeframe: Timeframe; cutoff: string; bars?: DayBar[]; base?: string; remove?: string[]; upsert?: DayBar[] }

/** Preserve every original checkpoint; replace only embedded bars with immutable observed-version refs. */
function encode(file: RecordingFile, incremental: boolean) {
  const versions: SeriesVersion[] = []
  const seen = new Map<string, string>()
  const previous = new Map<Timeframe, { id: string; bars: DayBar[]; depth: number }>()
  const checkpoints = file.checkpoints.map(checkpoint => {
    if (!checkpoint.chart) return checkpoint
    const { bars, ...chart } = checkpoint.chart
    const key = hash({ timeframe: chart.timeframe, bars })
    let ref = seen.get(key)
    if (!ref) {
      ref = `s${versions.length + 1}`
      const full: SeriesVersion = { id: ref, timeframe: chart.timeframe, cutoff: checkpoint.training!.training.currentDate!, bars }
      const prev = previous.get(chart.timeframe)
      let version = full, depth = 0
      if (incremental && prev && prev.depth < 31) {
        const old = new Map(prev.bars.map(bar => [bar.date, bar]))
        const dates = new Set(bars.map(bar => bar.date))
        const delta: SeriesVersion = { id: ref, timeframe: chart.timeframe, cutoff: full.cutoff, base: prev.id,
          remove: prev.bars.filter(bar => !dates.has(bar.date)).map(bar => bar.date),
          upsert: bars.filter(bar => JSON.stringify(old.get(bar.date)) !== JSON.stringify(bar)) }
        if (bytes(delta) < bytes(full)) { version = delta; depth = prev.depth + 1 }
      }
      versions.push(version)
      seen.set(key, ref)
      previous.set(chart.timeframe, { id: ref, bars, depth })
    }
    return { ...checkpoint, chart: { ...chart, seriesRef: ref } }
  })
  return { ...file, schemaVersion: 2, experiment: true, versions, checkpoints }
}

function verifyExact(file: RecordingFile, packed: ReturnType<typeof encode>) {
  const restored = new Map<string, DayBar[]>()
  const previousByTimeframe = new Map<Timeframe, DayBar[]>()
  const replacementSamples: Array<{timeframe: Timeframe; cutoff: string; changedRows: number}> = []
  let maxDeltaRows = 0, deltaRows = 0, fullVersions = 0
  for (const version of packed.versions) {
    let bars: DayBar[]
    if (version.bars) {
      bars = version.bars; fullVersions++
      const previous = previousByTimeframe.get(version.timeframe)
      if (previous) {
        const old = new Map(previous.map(bar => [bar.date, JSON.stringify(bar)]))
        const changedRows = bars.filter(bar => old.has(bar.date) && old.get(bar.date) !== JSON.stringify(bar)).length
        if (changedRows > 0) replacementSamples.push({timeframe:version.timeframe,cutoff:version.cutoff,changedRows})
      }
    }
    else {
      const state = new Map(restored.get(version.base!)!.map(bar => [bar.date, bar]))
      for (const date of version.remove!) state.delete(date)
      for (const bar of version.upsert!) state.set(bar.date, bar)
      bars = [...state.values()].sort((a, b) => a.date.localeCompare(b.date))
      maxDeltaRows = Math.max(maxDeltaRows, version.upsert!.length)
      deltaRows += version.upsert!.length
    }
    assert(bars.every(bar => (bar.date.length === 7 ? bar.date + '-01' : bar.date) <= version.cutoff))
    restored.set(version.id, bars)
    previousByTimeframe.set(version.timeframe, bars)
  }
  for (let index = 0; index < packed.checkpoints.length; index++) {
    const checkpoint = packed.checkpoints[index]
    if (!checkpoint.chart) { assert.deepEqual(file.checkpoints[index], checkpoint); continue }
    const { seriesRef, ...chart } = checkpoint.chart as Omit<ChartCapture, 'bars'> & { seriesRef: string }
    assert.deepEqual({ ...checkpoint, chart: { ...chart, bars: restored.get(seriesRef) } }, file.checkpoints[index])
  }
  assert.deepEqual(packed.events, file.events)
  return { exactCheckpoints: file.checkpoints.length, exactChartSnapshots: file.checkpoints.filter(c => c.chart).length, fullVersions, deltaVersions: packed.versions.length - fullVersions, deltaRows, maxDeltaRows, replacementSamples }
}

function corpus(all: DayBar[], rights: AdjustmentEvent[], steps: number, forward: boolean, multiPeriod: boolean): RecordingFile {
  const start = all.findIndex(bar => bar.date >= '2024-09-16')
  const segmentId = randomUUID()
  const file: RecordingFile = { format:'trainer-session',schemaVersion:1,sessionId:randomUUID(),createdAt:'2026-09-19T00:00:00.000Z',app:{version:'0.1.0',gitCommit:'assessment',dirty:true,chartLibrary:'10.0.3'},environment:{timezone:'Asia/Shanghai',viewport:{width:1280,height:900},dpr:1},trainingKey:'assessment',events:[],checkpoints:[],gaps:[],complete:true }
  let index = start, tf: Timeframe = '1D', displayed: DayBar[] = []
  const checkpoint = (includeChart: boolean) => {
    const date = all[index].date
    const cp: RecordingCheckpoint = {id:randomUUID(),afterSeq:file.events.length,segmentId,capturedAt:'2026-09-19T00:00:00.000Z',training:{training:{id:1,tier:'2Y',code:'600519',name:'贵州茅台',market:'sh',startDate:all[start].date,plannedEnd:'2026-09-18',currentDate:date,status:'running',settleDate:null,earlySettle:false,blind:false,adjustMode:forward?'forward':'raw',initialCash:1000000,createdAt:file.createdAt},account:{cash:1000000,shares:0,availableShares:0,costPrice:null,marketValue:0,equity:1000000},trades:[]},chart:includeChart?{timeframe:tf,bars:displayed,drawings:[],view:{fromTimestamp:Date.parse(displayed[0].date),toTimestamp:Date.parse(displayed.at(-1)!.date),barSpace:8,paneHeights:{candle_pane:400,VOL:120,MACD:120}},costPrice:null}:null,ui:{theme:'dark',tool:null,magnet:'weak_magnet',multiSelect:false},context:null}
    file.checkpoints.push(cp)
    return cp.id
  }
  function action(name: 'training.advance' | 'chart.load' | 'chart.timeframe', chart: boolean) {
    const opId = randomUUID()
    file.events.push({seq:file.events.length+1,opId,segmentId,elapsedMs:file.events.length*100,phase:'started',action:name,source:'ui'})
    file.events.push({seq:file.events.length+1,opId,segmentId,elapsedMs:file.events.length*100,phase:'finished',action:name,source:'ui',outcome:'accepted',result:null})
    file.events.at(-1)!.checkpointId = checkpoint(chart)
  }
  function load() {
    const upto = all.slice(0,index+1)
    const observed = forward ? applyForwardAdjustment(upto, rights, all[index].date) : upto
    displayed = aggregateBars(observed, tf).slice(-1040)
  }
  load(); checkpoint(true)
  for (index = start+1; index <= start+steps; index++) {
    action('training.advance',false);load();action('chart.load',true);checkpoint(true)
    if (multiPeriod && (index-start)%20===0) {
      for (const period of ['1W','1M','1D'] as const) {tf=period;action('chart.timeframe',false);load();action('chart.load',true);checkpoint(true)}
    }
  }
  validateRecording(file)
  return file
}

function measure(file: RecordingFile, label: string) {
  const legacyText = JSON.stringify(file)
  const fullBytes = Buffer.byteLength(legacyText)
  const barBytes = file.checkpoints.reduce((sum, cp) => sum + (cp.chart ? bytes(cp.chart.bars) : 0), 0)
  const operationBytes = bytes(file.events)
  const trainingBytes = file.checkpoints.reduce((sum, cp) => sum + bytes(cp.training),0)
  const drawingBytes = file.checkpoints.reduce((sum, cp) => sum + (cp.chart ? bytes(cp.chart.drawings):0),0)
  const legacyGzip = gzipSync(legacyText,{level:6})
  assert.equal(gunzipSync(legacyGzip).toString(),legacyText)
  const output: any = {label,events:file.events.length,checkpoints:file.checkpoints.length,barCopies:file.checkpoints.filter(cp=>cp.chart).length,composition:{jsonBytes:fullBytes,barBytes,barPercent:+(100*barBytes/fullBytes).toFixed(2),operationBytes,trainingBytes,drawingBytes,remainingBytes:fullBytes-barBytes-operationBytes-trainingBytes-drawingBytes},variants:[{name:'current-json',bytes:fullBytes},{name:'current-json-gzip',bytes:legacyGzip.length}]}
  for (const incremental of [false,true]) {
    const start = performance.now()
    const packed = encode(file,incremental)
    const encoded = JSON.stringify(packed)
    const jsonBytes = Buffer.byteLength(encoded)
    const zip = gzipSync(encoded,{level:6})
    const decodeStart = performance.now()
    const decoded = JSON.parse(gunzipSync(zip).toString())
    const verified = verifyExact(file,decoded)
    output.variants.push({name:incremental?'versioned-deltas-json':'whole-series-dedup-json',bytes:jsonBytes,gzipBytes:zip.length,versionCount:packed.versions.length,verification:verified,offlineTotalMs:Math.round(performance.now()-start),offlineDecodeAndVerifyMs:Math.round(performance.now()-decodeStart)})
  }
  return output
}

async function main() {
  const [dayPath, rightsPath, outputPath] = process.argv.slice(2)
  if (!dayPath || !rightsPath || !outputPath) throw Error('Usage: assess-recording-compression.ts frozen.day frozen-gbbq result.json')
  const all = await readDayFile(dayPath)
  const rights = (await readGbbqFile(rightsPath)).filter(e=>e.code==='600519'&&e.market==='sh')
  const start = all.findIndex(bar=>bar.date>='2024-09-16'),end=all.findLastIndex(bar=>bar.date<='2026-09-16')
  assert(start>=1039&&end-start>=120)
  const result:any={kind:'recording-compression-experiment',date:'2026-09-19',runtime:process.version,source:{daySha256:createHash('sha256').update(await readFile(dayPath)).digest('hex'),rightsSha256:createHash('sha256').update(await readFile(rightsPath)).digest('hex'),from:all[start].date,to:all[end].date,loadedBars:1040,rightsInPeriod:rights.filter(e=>e.date>=all[start].date&&e.date<=all[end].date).map(e=>e.date)},method:['Offline corpus mirrors current three-checkpoint-per-advance wiring, with real frozen OHLC and project forward-adjustment/aggregation functions.','No trades, drawings or loaded earlier history in corpus; separate drawing example measured below.','Experimental codecs preserve all events and chart snapshots; full anchor at most every 32 versions, or when patch is larger than full array.','Whole-series dedup and delta sizes do not deduplicate training/account metadata.','gzip level 6; all versions decompressed and every chart snapshot deep-equal verified. Not production codec, browser timing or product capacity promise.'],cases:[]}
  for(const [steps,forward,multi,label] of [[120,false,false,'120 advances raw daily'],[end-start,false,false,'two-year raw daily'],[120,true,false,'120 advances forward daily'],[end-start,true,true,'two-year forward with weekly/monthly views every 20 days']] as const){
    const measured=measure(corpus(all,rights,steps,forward,multi),label)
    result.cases.push(measured)
    console.log(JSON.stringify({label,barPercent:measured.composition.barPercent,variants:measured.variants.map((v:any)=>({name:v.name,bytes:v.bytes,gzipBytes:v.gzipBytes,verified:v.verification?.exactChartSnapshots}))}))
  }
  // Exercise drawing metadata and interrupted intervals through the same lossless codec.
  // These are synthetic codec fixtures, not claims of real UI drawing or validated lifecycle events.
  const edge = corpus(all,rights,5,true,true)
  for(let index=0;index<edge.checkpoints.length;index++) {
    const checkpoint=edge.checkpoints[index]
    if(checkpoint.chart) {
      const line={id:'line-1',name:'segment',paneId:'candle_pane',points:[{timestamp:Date.parse(all[start].date),value:1420},{timestamp:Date.parse(all[start+index%5].date),value:1500+index}],styles:{line:{color:'#ff5555',size:1}}}
      checkpoint.chart.drawings = index%4===0 ? [] : [line,{id:'text-1',name:'textAnnotation',paneId:'candle_pane',points:[{timestamp:Date.parse(all[start].date),value:1410}],extendData:{text:'复盘：观察支撑位',size:14,color:'#ff5555',bold:false,italic:false}}]
    }
    checkpoint.ui.theme=index%2?'dark':'light'
    checkpoint.context={observedAt:checkpoint.capturedAt,rules:{feesEnabled:true,tPlusOne:true}}
  }
  edge.gaps=[{afterSeq:4,resumedAtSeq:5}]
  const edgePacked=encode(edge,true)
  const edgeDecoded=JSON.parse(gunzipSync(gzipSync(JSON.stringify(edgePacked))).toString())
  result.syntheticCodecCheck={...verifyExact(edge,edgeDecoded),gapsPreserved:JSON.stringify(edge.gaps)===JSON.stringify(edgeDecoded.gaps),covers:['changed drawing anchors','text/style payloads','delete/restore drawing states','theme and rule context','pause gap metadata'],note:'Synthetic metadata fixture; no actual UI drawing, trade execution or gap validator assertions.'}
  const drawing={id:'drawing-1',name:'segment',paneId:'candle_pane',points:[{timestamp:Date.parse('2025-01-02'),value:1420},{timestamp:Date.parse('2025-01-15'),value:1520}],styles:{line:{color:'#ff5555',size:1,style:'solid'}}}
  result.exampleBytes={lineDrawing:bytes(drawing),advanceCommand:bytes({seq:1,action:'training.advance',date:'2025-01-02'}),buyCommand:bytes({seq:2,action:'training.trade',params:{side:'buy',shares:100},outcome:'accepted',result:{price:1420,fee:42.6}})}
  await writeFile(outputPath,JSON.stringify(result,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})

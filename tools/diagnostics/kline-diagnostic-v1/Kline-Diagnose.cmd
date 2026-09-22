@echo off
setlocal
chcp 65001 >nul
set "KLINE_DIAG_SELF=%~f0"
if /I "%~1"=="--no-open" set "KLINE_DIAG_NONINTERACTIVE=1"
echo K-line Trainer Diagnostics - checking, please wait...
powershell.exe -NoLogo -NoProfile -Command "$s=[IO.File]::ReadAllText($env:KLINE_DIAG_SELF,[Text.Encoding]::UTF8); $m='# '+'KLINE_DIAG_POWERSHELL'; $i=$s.IndexOf($m); if($i -lt 0){throw 'Diagnostic script is incomplete'}; & ([scriptblock]::Create($s.Substring($i+$m.Length)))"
set "KLINE_DIAG_EXIT=%ERRORLEVEL%"
if not "%KLINE_DIAG_EXIT%"=="0" echo Diagnostic failed. Please send a screenshot of this window.
if not defined KLINE_DIAG_NONINTERACTIVE pause
exit /b %KLINE_DIAG_EXIT%
# KLINE_DIAG_POWERSHELL
$ErrorActionPreference = 'Stop'
$report = New-Object 'System.Collections.Generic.List[string]'
$findings = New-Object 'System.Collections.Generic.List[string]'
function Note([string]$text) { $report.Add($text) }
function Finding([string]$text) { $findings.Add($text) }
function Field($obj, [string]$name) {
    if ($null -ne $obj -and $null -ne $obj.PSObject.Properties[$name]) { return $obj.$name }
    return $null
}
function ResolveLocal([string]$value, [string]$base) {
    if ([IO.Path]::IsPathRooted($value)) { return [IO.Path]::GetFullPath($value) }
    return [IO.Path]::GetFullPath((Join-Path $base $value))
}
function ReadJson([string]$path) {
    $raw = [IO.File]::ReadAllText($path)
    return ($raw | ConvertFrom-Json -ErrorAction Stop)
}
function LocalGet([int]$port, [string]$path) {
    $response = $null
    $reader = $null
    try {
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port$path")
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.Timeout = 2500
        $request.ReadWriteTimeout = 2500
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { throw "HTTP $([int]$response.StatusCode); 未跟随跳转" }
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        $buffer = New-Object char[] 65537
        $count = $reader.ReadBlock($buffer, 0, $buffer.Length)
        if ($count -gt 65536) { throw '响应超过诊断读取上限' }
        $body = -join $buffer[0..([Math]::Max(0, $count - 1))]
        return ($body | ConvertFrom-Json -ErrorAction Stop)
    } finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
    }
}

$packageRoot = [IO.Path]::GetDirectoryName($env:KLINE_DIAG_SELF)
Note 'K 线训练器诊断报告 v1'
Note ('生成时间：' + (Get-Date -Format o))
Note ('脚本所在目录：' + $packageRoot)
Note ('PowerShell：' + $PSVersionTable.PSVersion.ToString())
Note '本工具只检查本机文件与本机服务；仅新建本报告，不改配置、不停止进程、不上传数据。'
Note '报告含安装路径和进程号，不含行情正文、训练数据库或完整配置/日志。'

try {
    Note "`r`n[1] 安装目录与真实文件名"
    foreach ($name in @('Start.cmd','Stop.cmd','launcher.cjs','runtime\node.exe','server\dist\index.js','web\dist','release.json')) {
        Note ($name + '：' + (Test-Path -LiteralPath (Join-Path $packageRoot $name)))
    }
    if (!(Test-Path -LiteralPath (Join-Path $packageRoot 'Start.cmd'))) {
        Finding '脚本没有放在 Start.cmd 所在目录；请放到训练器完整解压目录后重跑。'
    }
    $files = @(Get-ChildItem -LiteralPath $packageRoot -File -Filter 'trainer*' | Select-Object -First 30)
    foreach ($file in $files) { Note ('配置候选文件：' + $file.Name) }
    if (!$files.Count) { Note '没有 trainer 开头的文件。' }
    $releasePath = Join-Path $packageRoot 'release.json'
    if (Test-Path -LiteralPath $releasePath) {
        try {
            $release = ReadJson $releasePath
            Note ('发布版本：' + (Field $release 'version'))
            Note ('源码版本：' + (Field $release 'gitCommit'))
        } catch { Note ('release.json 无法读取：' + $_.Exception.Message) }
    }

    Note "`r`n[2] 启动配置（只显示有关字段）"
    $configPath = Join-Path $packageRoot 'trainer.config.json'
    $config = $null
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $bytes = [IO.File]::ReadAllBytes($configPath)
            if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
                Finding '配置含 UTF-8 BOM；当前发布版的 JSON.parse 可能拒绝此文件。'
            } elseif ($bytes.Length -ge 2 -and (($bytes[0] -eq 255 -and $bytes[1] -eq 254) -or ($bytes[0] -eq 254 -and $bytes[1] -eq 255))) {
                Finding '配置采用 UTF-16 编码；发布版按 UTF-8 读取，需另存为 UTF-8 无 BOM。'
            }
            $config = ReadJson $configPath
            if ($config -isnot [pscustomobject]) { throw '配置顶层必须为 JSON 对象' }
            foreach ($key in @('tdxRoot','port','dataDir','databasePath')) { Note ($key + '：' + (Field $config $key)) }
            Note 'PowerShell JSON 读取成功；不等同于启动器严格 JSON 解析已通过。'
        } catch { Finding ('配置无法解析：' + $_.Exception.Message); $config = $null }
    } else {
        Finding '缺少准确命名的 trainer.config.json；检查是否仍为 example、.json.txt 或 .jison。'
    }
    foreach ($key in @('TDX_ROOT','TRAINER_DB')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        Note ('环境变量 ' + $key + '：' + $(if ($value) { $value } else { '未设置' }))
    }
    $port = 8787
    $configuredPort = Field $config 'port'
    if ($null -ne $configuredPort) {
        $parsedPort = 0
        if ([int]::TryParse([string]$configuredPort, [ref]$parsedPort) -and $parsedPort -gt 0 -and $parsedPort -le 65535) { $port = $parsedPort }
        else { Finding '配置端口无效；本次只检查默认 8787。' }
    }
    $configuredDataDir = [string](Field $config 'dataDir')
    $dataDir = if ($configuredDataDir.Trim()) { ResolveLocal $configuredDataDir.Trim() $packageRoot } else { Join-Path $env:USERPROFILE '.a-share-kline-trainer' }
    Note ('按当前文件推导的数据目录：' + $dataDir)

    Note "`r`n[3] 启动记录"
    $statePath = Join-Path $dataDir 'trainer-state.json'
    $state = $null
    $stateExists = Test-Path -LiteralPath $statePath -PathType Leaf
    Note ('记录路径：' + $statePath)
    Note ('记录存在：' + $stateExists)
    if ($stateExists) {
        try {
            $state = ReadJson $statePath
            foreach ($key in @('appId','pid','port','version','databasePath','tdxRoot','startedAt')) { Note ($key + '：' + (Field $state $key)) }
        } catch { Finding ('启动记录无法解析：' + $_.Exception.Message) }
    }

    Note "`r`n[4] 端口与运行中的服务"
    foreach ($probePort in (@($port,8787) | Select-Object -Unique)) {
        Note ('检查端口：' + $probePort)
        try {
            $connections = @(Get-NetTCPConnection -LocalPort $probePort -State Listen -ErrorAction SilentlyContinue)
            if (!$connections.Count) { Note '未发现监听记录，或当前权限无法读取。' }
            foreach ($owner in ($connections.OwningProcess | Sort-Object -Unique)) {
                if ($null -eq $owner) { continue }
                $process = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -OperationTimeoutSec 5
                Note ('监听进程 PID：' + $owner + '；程序：' + $process.Name)
                Note ('程序完整路径：' + $(if ($process.ExecutablePath) { $process.ExecutablePath } else { '权限不足或进程已退出' }))
            }
        } catch { Note ('监听进程检查不可用：' + $_.Exception.Message) }
        try {
            $health = LocalGet $probePort '/api/health'
            $servicePid = 0
            $trainerLike = (Field $health 'status') -eq 'ok' -and [int]::TryParse([string](Field $health 'pid'), [ref]$servicePid) -and $servicePid -gt 0 -and $null -ne $health.PSObject.Properties['runId']
            if (!$trainerLike) { Note '健康响应不符合训练器格式，不继续访问它的接口。'; continue }
            Note ('训练器健康响应：ok；PID：' + $servicePid + '；带启动标识：' + [bool](Field $health 'runId'))
            if (!$stateExists) {
                Finding ('端口 ' + $probePort + ' 有训练器响应，但当前数据目录没有启动记录；此目录下的 Stop.cmd 无法据此停止它。')
            } elseif ($null -ne $state) {
                $same = (Field $state 'pid') -eq $servicePid -and (Field $state 'port') -eq $probePort -and (Field $state 'runId') -eq (Field $health 'runId')
                Note ('与启动记录 PID/端口/runId 匹配：' + $same)
                if (!$same) { Finding ('端口 ' + $probePort + ' 的服务与当前启动记录不匹配。') }
            }
            try {
                $status = LocalGet $probePort '/api/data/status'
                $tdx = Field $status 'tdx'
                Note ('服务实际 TDX 路径：' + $(if (Field $tdx 'root') { Field $tdx 'root' } else { '未连接' }))
                Note ('TDX 可用：' + (Field $tdx 'available'))
                Note ('状态原因：' + (Field $status 'reason'))
                Note ('行情截止：' + (Field $status 'sourceMaxDate'))
                Note ('上次扫描：' + (Field $status 'lastCheckedAt'))
                if ((Field $config 'tdxRoot') -and !(Field $tdx 'root')) {
                    Finding '文件里填写了通达信路径，但当前服务未连接；需核对服务是否由这份配置启动，以及目录是否可读。'
                }
            } catch { Note ('数据状态接口失败：' + $_.Exception.Message) }
        } catch { Note ('健康接口无法读取：' + $_.Exception.Message) }
    }

    Note "`r`n[5] 通达信目录（只检查目录/文件名，不读行情正文）"
    $tdxValue = if ($env:TDX_ROOT -and $env:TDX_ROOT.Trim()) { $env:TDX_ROOT.Trim() } else { [string](Field $config 'tdxRoot') }
    $roots = if ($tdxValue.Trim()) { @(ResolveLocal $tdxValue.Trim() $packageRoot) } else { @('D:\MySoftWares\TDX','C:\new_tdx','C:\通达信') }
    foreach ($root in $roots) {
        Note ('检查目录：' + $root)
        Note ('目录存在：' + (Test-Path -LiteralPath $root -PathType Container))
        $hasDaily = $false
        foreach ($market in @('sh','sz','bj')) {
            $dailyDir = Join-Path $root ('vipdoc\' + $market + '\lday')
            try {
                $hasFile = $false
                if (Test-Path -LiteralPath $dailyDir -PathType Container) {
                    $hasFile = $null -ne ([IO.Directory]::EnumerateFiles($dailyDir,'*.day') | Select-Object -First 1)
                }
                Note ($market + ' 市场 .day 文件存在：' + $hasFile)
                $hasDaily = $hasDaily -or $hasFile
            } catch { Note ($market + ' 市场无法检查：' + $_.Exception.Message) }
        }
        $hasCache = Test-Path -LiteralPath (Join-Path $root 'T0002\hq_cache') -PathType Container
        Note ('hq_cache 目录存在：' + $hasCache)
        Note ('gbbq 文件存在：' + (Test-Path -LiteralPath (Join-Path $root 'T0002\hq_cache\gbbq') -PathType Leaf))
        if ($tdxValue.Trim() -and (!$hasDaily -or !$hasCache)) {
            Finding '指定的通达信目录不满足启动器探测条件，或当前用户无法读取；确认选对安装根目录，并已下载盘后日线。'
        }
    }
} catch {
    Finding ('诊断有一项未能继续：' + $_.Exception.Message)
} finally {
    Note "`r`n[6] 诊断摘要"
    if (!$findings.Count) { Note '未发现上述明显异常；仍需结合具体报错判断，不代表完整功能验收通过。' }
    foreach ($item in ($findings | Select-Object -Unique)) { Note ('- ' + $item) }
    Note '请将本报告发给协助排查的人。本工具没有停止服务、修改配置、删除文件或读取训练数据库。'
    $reportName = 'Kline-Diagnostic-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6) + '.txt'
    $outputPath = $null
    foreach ($folder in @($packageRoot, [Environment]::GetFolderPath('Desktop'), [IO.Path]::GetTempPath())) {
        if (!$folder) { continue }
        try {
            $candidate = Join-Path $folder $reportName
            [IO.File]::WriteAllLines($candidate, $report, (New-Object Text.UTF8Encoding($true)))
            $outputPath = $candidate
            break
        } catch { }
    }
    if (!$outputPath) { $report | ForEach-Object { Write-Host $_ }; throw '报告无法保存，请拍摄窗口内容。' }
    Write-Host ('诊断完成，报告：' + $outputPath)
    Write-Host '请把这个 TXT 文件发回，便于继续定位问题。'
    if (!$env:KLINE_DIAG_NONINTERACTIVE) {
        try { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $outputPath + '"') }
        catch { Write-Host '记事本未能打开，请手动打开上面的报告文件。' }
    }
}

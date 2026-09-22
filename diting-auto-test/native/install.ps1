$ErrorActionPreference = "Stop"

$HostName = "com.diting.feishu_bridge"
$ExtensionId = "dmfabigojpaodgkkbhnceellgffalcij"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceBinary = Join-Path $ScriptDir "diting-native-host.exe"
$SourceCoreBinary = Join-Path $ScriptDir "diting-native-host-core.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "DitingBridge"
$BinaryPath = Join-Path $InstallDir "diting-native-host.exe"
$CoreBinaryPath = Join-Path $InstallDir "diting-native-host-core.exe"
$ConfigPath = Join-Path $InstallDir "config.json"
$ManifestPath = Join-Path $InstallDir "$HostName.json"

$NodePath = $env:NODE_PATH
if (-not $NodePath) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $NodeCommand) {
        throw "未找到 Node.js。请先安装 Node，并确保它能在 PowerShell 中执行。"
    }
    $NodePath = $NodeCommand.Source
}
if (-not (Test-Path $NodePath)) {
    throw "Node.js 路径无效：$NodePath"
}

$LarkCliPath = $env:LARK_CLI_PATH
$LarkCommand = $null
if (-not $LarkCliPath) {
    $LarkCommand = Get-Command lark-cli -ErrorAction SilentlyContinue
    if (-not $LarkCommand) {
        throw "未找到 lark-cli。请先安装、授权，并确保它能在 PowerShell 中执行。"
    }
    $LarkCliPath = $LarkCommand.Source
}
$LarkExtension = [System.IO.Path]::GetExtension($LarkCliPath).ToLowerInvariant()
$NodeEntryCandidates = @()
if ($LarkExtension -in @(".js", ".mjs", ".cjs")) {
    $NodeEntryCandidates += $LarkCliPath
}

# Official guided installs commonly use:
# %USERPROFILE%\.local\bin\lark-cli(.cmd/.ps1)
# %USERPROFILE%\.local\lib\node_modules\@larksuite\cli\scripts\run.js
if ($LarkCommand) {
    $CommandDir = Split-Path -Parent $LarkCommand.Source
    $PossibleLocalRoot = Split-Path -Parent $CommandDir
    $NodeEntryCandidates += (Join-Path $PossibleLocalRoot "lib\node_modules\@larksuite\cli\scripts\run.js")
}
$NodeEntryCandidates += (Join-Path $HOME ".local\lib\node_modules\@larksuite\cli\scripts\run.js")

$NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
if ($NpmCommand) {
    $NpmRoot = (& npm root -g 2>$null)
    if ($NpmRoot) {
        $NodeEntryCandidates += (Join-Path $NpmRoot "@larksuite\cli\scripts\run.js")
    }
}

foreach ($Candidate in $NodeEntryCandidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
        $LarkCliPath = (Resolve-Path $Candidate).Path
        break
    }
}
if ($LarkCliPath -match "\.(cmd|ps1|bat)$") {
    throw "已找到 lark-cli 命令，但无法定位其 Node.js 入口脚本。请重新执行 npx @larksuite/cli@latest install 后重试。"
}
if (-not (Test-Path $SourceBinary)) {
    throw "缺少桥接程序：$SourceBinary"
}
if (-not (Test-Path $SourceCoreBinary)) {
    throw "缺少桥接核心程序：$SourceCoreBinary"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force $SourceBinary $BinaryPath
Copy-Item -Force $SourceCoreBinary $CoreBinaryPath

$Config = [ordered]@{
    larkCliPath = $LarkCliPath
    nodePath = $NodePath
    baseToken = "REPLACE_WITH_TEST_BASE_TOKEN"
    tableId = "REPLACE_WITH_TEST_TABLE_ID"
    defaultTargetUrl = "https://example.feishu.cn/base/REPLACE_WITH_TEST_BASE_TOKEN?table=REPLACE_WITH_TEST_TABLE_ID&view=REPLACE_WITH_TEST_VIEW_ID"
    trustedTargetUrls = @(
        "https://example.feishu.cn/base/REPLACE_WITH_TEST_BASE_TOKEN?table=REPLACE_WITH_TEST_TABLE_ID&view=REPLACE_WITH_TEST_VIEW_ID"
    )
    attachmentField = "专业版数据"
    identity = "user"
}
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json), $Utf8NoBom)

$Manifest = [ordered]@{
    name = $HostName
    description = "谛听直播数据飞书桥接程序"
    path = $BinaryPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
[System.IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 4), $Utf8NoBom)

$RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Force -Path $RegistryPath | Out-Null
Set-Item -Path $RegistryPath -Value $ManifestPath

Write-Host "安装完成。"
Write-Host "桥接程序：$BinaryPath"
Write-Host "Chrome 清单：$ManifestPath"
Write-Host "扩展固定 ID：$ExtensionId"
Write-Host "请在 chrome://extensions 重新加载 WR-P-009-AUTO-SETTINGS-TEST-20260922 扩展，然后重启 Chrome。"

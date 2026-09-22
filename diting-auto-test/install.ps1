$ErrorActionPreference = "Stop"

$ProductVersion = "WR-P-009-AUTO-SETTINGS-TEST-20260922"
$ExtensionId = "dmfabigojpaodgkkbhnceellgffalcij"
$BaseToken = "REPLACE_WITH_TEST_BASE_TOKEN"
$TableId = "REPLACE_WITH_TEST_TABLE_ID"
$DefaultTargetUrl = "https://example.feishu.cn/base/REPLACE_WITH_TEST_BASE_TOKEN?table=REPLACE_WITH_TEST_TABLE_ID&view=REPLACE_WITH_TEST_VIEW_ID"
$RequiredWikiScope = "wiki:node:read"

$PackageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceExtension = Join-Path $PackageDir "extension"
$SourceNative = Join-Path $PackageDir "native"
$SetupDir = Join-Path $env:LOCALAPPDATA "DitingSetup"
$StateFile = Join-Path $SetupDir "install-state.json"
$ExtensionDir = Join-Path $env:LOCALAPPDATA "DitingExtension\extension"
$RuntimeDir = Join-Path $env:LOCALAPPDATA "DitingRuntime\node"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Info([string]$Message) {
    Write-Host "[谛听] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[完成] $Message" -ForegroundColor Green
}

function Stop-Install([string]$Message) {
    throw $Message
}

function Get-SavedState {
    if (-not (Test-Path $StateFile)) {
        return $null
    }
    try {
        return Get-Content -Raw -Encoding UTF8 $StateFile | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-ChromePath($SavedState) {
    $Candidates = @()
    if ($SavedState -and $SavedState.chromePath) {
        $Candidates += [string]$SavedState.chromePath
    }
    $Candidates += @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path $Candidate)) {
            return (Resolve-Path $Candidate).Path
        }
    }
    return $null
}

function Get-NodePath($SavedState) {
    $Candidates = @()
    if ($SavedState -and $SavedState.nodePath) {
        $Candidates += [string]$SavedState.nodePath
    }
    $Command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($Command) {
        $Candidates += $Command.Source
    }
    $Candidates += @(
        (Join-Path $RuntimeDir "node.exe"),
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path $Candidate)) {
            return (Resolve-Path $Candidate).Path
        }
    }
    return $null
}

function Install-ManagedNode {
    $Architecture = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -eq "Arm64") {
        "arm64"
    } else {
        "x64"
    }
    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("diting-node-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    try {
        Write-Info "未找到 Node.js，正在安装官方 Node.js 24 LTS 到用户目录..."
        $SumsUrl = "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt"
        $SumsPath = Join-Path $TempDir "SHASUMS256.txt"
        Invoke-WebRequest -UseBasicParsing -Uri $SumsUrl -OutFile $SumsPath
        $Pattern = "node-v[\d.]+-win-$Architecture\.zip"
        $Line = Get-Content $SumsPath | Where-Object { $_ -match $Pattern } | Select-Object -First 1
        if (-not $Line) {
            Stop-Install "未能从 Node.js 官方校验文件识别当前架构安装包。"
        }
        $Parts = $Line -split "\s+"
        $ExpectedHash = $Parts[0].ToLowerInvariant()
        $ArchiveName = $Parts[-1]
        $ArchivePath = Join-Path $TempDir $ArchiveName
        Invoke-WebRequest -UseBasicParsing `
            -Uri "https://nodejs.org/dist/latest-v24.x/$ArchiveName" `
            -OutFile $ArchivePath
        $ActualHash = (Get-FileHash -Algorithm SHA256 $ArchivePath).Hash.ToLowerInvariant()
        if ($ExpectedHash -ne $ActualHash) {
            Stop-Install "Node.js 安装包校验失败，已停止安装。"
        }
        $ExtractDir = Join-Path $TempDir "extracted"
        Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force
        $ExtractedRoot = Get-ChildItem -Directory $ExtractDir | Select-Object -First 1
        if (-not $ExtractedRoot) {
            Stop-Install "Node.js 安装包结构无效。"
        }
        if (Test-Path $RuntimeDir) {
            Remove-Item -Recurse -Force $RuntimeDir
        }
        New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
        Copy-Item -Path (Join-Path $ExtractedRoot.FullName "*") -Destination $RuntimeDir -Recurse -Force
        return (Join-Path $RuntimeDir "node.exe")
    } finally {
        if (Test-Path $TempDir) {
            Remove-Item -Recurse -Force $TempDir
        }
    }
}

function Get-LarkCommand($SavedState) {
    $Candidates = @()
    if ($SavedState -and $SavedState.larkCliPath) {
        $Candidates += [string]$SavedState.larkCliPath
    }
    $Command = Get-Command lark-cli.cmd -ErrorAction SilentlyContinue
    if (-not $Command) {
        $Command = Get-Command lark-cli.exe -ErrorAction SilentlyContinue
    }
    if (-not $Command) {
        $Command = Get-Command lark-cli -ErrorAction SilentlyContinue
    }
    if ($Command) {
        $Candidates += $Command.Source
    }
    $Candidates += @(
        (Join-Path $HOME ".local\bin\lark-cli.cmd"),
        (Join-Path $HOME ".local\bin\lark-cli.exe"),
        (Join-Path $HOME ".local\bin\lark-cli.ps1"),
        (Join-Path $env:APPDATA "npm\lark-cli.cmd")
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path $Candidate)) {
            return (Resolve-Path $Candidate).Path
        }
    }
    return $null
}

function Get-LarkNodeEntry([string]$LarkCommand, [string]$NodePath) {
    if ($LarkCommand -match "\.(js|mjs|cjs)$" -and (Test-Path $LarkCommand)) {
        return (Resolve-Path $LarkCommand).Path
    }
    $Candidates = @(
        (Join-Path $HOME ".local\lib\node_modules\@larksuite\cli\scripts\run.js")
    )
    $NpmPath = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
    if (Test-Path $NpmPath) {
        try {
            $NpmRoot = & $NpmPath root -g 2>$null
            if ($NpmRoot) {
                $Candidates += (Join-Path ([string]$NpmRoot).Trim() "@larksuite\cli\scripts\run.js")
            }
        } catch {}
    }
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path $Candidate)) {
            return (Resolve-Path $Candidate).Path
        }
    }
    return $null
}

function Invoke-Lark {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )
    if ($script:LarkCommandPath -match "\.(js|mjs|cjs)$") {
        & $script:NodePathValue $script:LarkCommandPath @Arguments
    } else {
        & $script:LarkCommandPath @Arguments
    }
}

function Test-LarkReady {
    try {
        $Json = (Invoke-Lark auth status --verify --json 2>$null) -join "`n"
        if (-not $Json) {
            return $false
        }
        $Status = $Json | ConvertFrom-Json
        $User = $Status.identities.user
        if (-not $User -and $Status.data) {
            $User = $Status.data.identities.user
        }
        $ValidStatus = $User.status -in @("ready", "needs_refresh")
        return $User.available -eq $true -and $User.verified -eq $true -and $ValidStatus
    } catch {
        return $false
    }
}

function Test-TargetTableAccess {
    try {
        Invoke-Lark base +field-list `
            --as user `
            --base-token $BaseToken `
            --table-id $TableId `
            --format json 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Test-ContactAccess {
    try {
        Invoke-Lark contact +search-user `
            --as user `
            --user-ids me `
            --format json 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Test-DefaultTargetAccess {
    try {
        Invoke-Lark base +url-resolve `
            --as user `
            --url $DefaultTargetUrl `
            --format json 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-LarkAppId {
    try {
        $Json = (Invoke-Lark auth status --json 2>$null) -join "`n"
        if (-not $Json) {
            return ""
        }
        $Status = $Json | ConvertFrom-Json
        if ($Status.appId) {
            return [string]$Status.appId
        }
        if ($Status.data -and $Status.data.appId) {
            return [string]$Status.data.appId
        }
    } catch {
    }
    return ""
}

function Test-LarkCapabilities {
    try {
        Invoke-Lark contact +search-user --help 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        Invoke-Lark base +url-resolve --help 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        Invoke-Lark auth check --help 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Ensure-LarkCapabilities {
    if (Test-LarkCapabilities) {
        return
    }
    Write-Info "当前 lark-cli 缺少人员查询能力，正在执行官方更新..."
    Invoke-Lark update
    if ($LASTEXITCODE -ne 0 -or -not (Test-LarkCapabilities)) {
        Stop-Install "lark-cli 更新后仍缺少所需能力，请手动执行 lark-cli update 后重试。"
    }
    Write-Ok "lark-cli 已更新并具备所需能力。"
}

function Initialize-LarkLogin {
    # Older lark-cli releases expose a different auth-status JSON structure.
    # A successful read against the real target table is the most reliable
    # cross-version proof that the user token and required scopes are usable.
    if ((Test-TargetTableAccess) -and (Test-ContactAccess)) {
        if (-not (Test-DefaultTargetAccess)) {
            Write-Host "[提示] 默认直连地址未能由 lark-cli 解析，但目标表字段读取已通过；将使用内置 Base Token 和 Table ID 安全回退。" -ForegroundColor Yellow
        }
        Write-Ok "lark-cli 用户身份、目标表格与通讯录权限均有效。"
        return
    }
    Write-Host "[提示] lark-cli 尚未登录或凭证已失效，接下来会打开浏览器完成飞书授权。" -ForegroundColor Yellow
    try {
        Invoke-Lark auth login --domain "base,drive,contact" --scope $RequiredWikiScope
        if ($LASTEXITCODE -ne 0) {
            throw "login failed"
        }
    } catch {
        Write-Host "[提示] 当前 lark-cli 尚未初始化，正在创建本地配置后重试。" -ForegroundColor Yellow
        Invoke-Lark config init --new
        if ($LASTEXITCODE -ne 0) {
            Stop-Install "lark-cli 初始化失败。"
        }
        Invoke-Lark auth login --domain "base,drive,contact" --scope $RequiredWikiScope
        if ($LASTEXITCODE -ne 0) {
            Stop-Install "飞书登录命令执行失败。"
        }
    }
    if (-not (Test-TargetTableAccess)) {
        Stop-Install "飞书授权命令已结束，但仍无法读取目标多维表格。请确认登录账号拥有该表权限。"
    }
    if (-not (Test-ContactAccess)) {
        Stop-Install "飞书授权命令已结束，但仍无法查询人员。请确认已授予 contact 通讯录权限。"
    }
    if (-not (Test-DefaultTargetAccess)) {
        Write-Host "[提示] 默认直连地址未能由 lark-cli 解析，但目标表字段读取已通过；将使用内置 Base Token 和 Table ID 安全回退。" -ForegroundColor Yellow
    }
    Write-Ok "lark-cli 登录验证通过。"
}

try {
    Write-Host ""
    Write-Info "「谛听」百应场控数据采集 $ProductVersion 一键安装（Windows）"
    if (-not (Test-Path (Join-Path $SourceExtension "manifest.json"))) {
        Stop-Install "安装包不完整：缺少 extension\manifest.json"
    }
    if (-not (Test-Path (Join-Path $SourceNative "install.ps1"))) {
        Stop-Install "安装包不完整：缺少 native\install.ps1"
    }
    # 安装器本身已由用户主动运行；解除同一安装包内文件的下载区标记，
    # 避免 Chrome 启动 Native Messaging 子进程时被 Windows 静默阻止。
    Get-ChildItem -Path $PackageDir -Recurse -File -ErrorAction SilentlyContinue |
        Unblock-File -ErrorAction SilentlyContinue

    $SavedState = Get-SavedState
    $ChromePath = Get-ChromePath $SavedState
    if (-not $ChromePath) {
        Start-Process "https://www.google.com/chrome/"
        Stop-Install "未找到 Google Chrome。已打开官方下载页，请安装 Chrome 后重新运行本安装器。"
    }
    Write-Ok "已找到 Google Chrome：$ChromePath"

    $NodeManaged = $false
    $NodePath = Get-NodePath $SavedState
    if (-not $NodePath) {
        $NodePath = Install-ManagedNode
        $NodeManaged = $true
        Write-Ok "Node.js 已安装：$NodePath"
    } else {
        $NodeManaged = $NodePath -eq (Join-Path $RuntimeDir "node.exe")
        Write-Ok "复用现有 Node.js：$NodePath（$(& $NodePath --version)）"
    }
    $NodeDir = Split-Path -Parent $NodePath
    $env:Path = "$NodeDir;$HOME\.local\bin;$env:APPDATA\npm;$env:Path"

    $LarkManaged = $false
    $LarkCommand = Get-LarkCommand $SavedState
    if (-not $LarkCommand) {
        Write-Info "未找到 lark-cli，正在使用官方安装命令安装..."
        $NpxPath = Join-Path $NodeDir "npx.cmd"
        if (-not (Test-Path $NpxPath)) {
            Stop-Install "当前 Node.js 中未找到 npx.cmd。"
        }
        & $NpxPath --yes "@larksuite/cli@latest" install
        if ($LASTEXITCODE -ne 0) {
            Stop-Install "lark-cli 官方安装命令执行失败。"
        }
        $LarkCommand = Get-LarkCommand $null
        if (-not $LarkCommand) {
            Stop-Install "lark-cli 安装命令已结束，但仍未找到可执行文件。"
        }
        $LarkManaged = $true
        Write-Ok "lark-cli 已安装：$LarkCommand"
    } else {
        Write-Ok "复用现有 lark-cli：$LarkCommand"
    }
    $script:NodePathValue = $NodePath
    $script:LarkCommandPath = $LarkCommand

    Ensure-LarkCapabilities
    Initialize-LarkLogin
    Write-Info "正在验证目标多维表格访问权限..."
    if (-not (Test-TargetTableAccess)) {
        Stop-Install "无法读取目标多维表格，请检查飞书授权或表格权限。"
    }
    Write-Ok "目标多维表格访问验证通过。"

    $ExtensionConfirmed = $false
    $ExistingVersion = $null
    $ExistingManifest = Join-Path $ExtensionDir "manifest.json"
    if (Test-Path $ExistingManifest) {
        try {
            $Manifest = Get-Content -Raw -Encoding UTF8 $ExistingManifest | ConvertFrom-Json
            $ExistingVersion = if ($Manifest.version_name) { $Manifest.version_name } else { $Manifest.version }
        } catch {}
    }
    if ($ExistingVersion -eq $ProductVersion) {
        Write-Ok "已找到同版本扩展文件，复用目录：$ExtensionDir"
        if ($SavedState -and $SavedState.extensionConfirmed) {
            $ExtensionConfirmed = $true
        }
    } else {
        Write-Info "正在部署扩展文件到固定目录..."
        if (Test-Path $ExtensionDir) {
            Remove-Item -Recurse -Force $ExtensionDir
        }
        New-Item -ItemType Directory -Force -Path $ExtensionDir | Out-Null
        Copy-Item -Path (Join-Path $SourceExtension "*") -Destination $ExtensionDir -Recurse -Force
        Write-Ok "扩展文件已部署：$ExtensionDir"
    }

    $LarkNodeEntry = Get-LarkNodeEntry $LarkCommand $NodePath
    if (-not $LarkNodeEntry) {
        Stop-Install "已找到 lark-cli 命令，但无法定位 Native Messaging 所需的 Node.js 入口脚本。请重新运行官方 lark-cli 安装命令后重试。"
    }
    Write-Info "正在安装 Native Messaging 桥接..."
    $env:NODE_PATH = $NodePath
    $env:LARK_CLI_PATH = $LarkNodeEntry
    & (Join-Path $SourceNative "install.ps1")
    if ($LASTEXITCODE -ne 0) {
        Stop-Install "Native Messaging 安装失败。"
    }
    Write-Ok "Native Messaging 已安装并绑定当前 Node/lark-cli 绝对路径。"

    if (-not $ExtensionConfirmed) {
        Write-Host "[提示] Chrome 个人版要求首次手动确认“加载已解压的扩展”。" -ForegroundColor Yellow
        Start-Process -FilePath $ChromePath -ArgumentList "chrome://extensions/"
        Start-Process explorer.exe -ArgumentList "`"$ExtensionDir`""
        Write-Host ""
        Write-Host "请完成以下一次性操作："
        Write-Host "  1. 在扩展程序页打开右上角“开发者模式”"
        Write-Host "  2. 点击“加载已解压的扩展程序”"
        Write-Host "  3. 选择已自动打开的 extension 文件夹"
        Write-Host "  4. 确认扩展 ID 为：$ExtensionId"
        Write-Host ""
        Read-Host "完成后按回车键继续"
        $ExtensionConfirmed = $true
    } else {
        Write-Ok "安装状态显示扩展已确认加载，本次无需重复操作。"
    }

    New-Item -ItemType Directory -Force -Path $SetupDir | Out-Null
    $State = [ordered]@{
        productVersion = $ProductVersion
        installedAt = [DateTime]::UtcNow.ToString("o")
        nodePath = $NodePath
        nodeManagedByDiting = $NodeManaged
        larkCliPath = $LarkCommand
        larkCliInstalledByDiting = $LarkManaged
        chromePath = $ChromePath
        extensionPath = $ExtensionDir
        extensionId = $ExtensionId
        extensionConfirmed = $ExtensionConfirmed
        nativeHostName = "com.diting.feishu_bridge"
    }
    [System.IO.File]::WriteAllText(
        $StateFile,
        ($State | ConvertTo-Json -Depth 4) + [Environment]::NewLine,
        $Utf8NoBom
    )

    Write-Host ""
    Write-Ok "全部安装与检查完成。"
    Write-Host "状态记录：$StateFile"
    Write-Host "扩展目录：$ExtensionDir"
    Write-Host "Node.js：$NodePath"
    Write-Host "lark-cli：$LarkCommand"
    Write-Host ""
    Write-Host "现在可打开百应页面，通过扩展采集并提交飞书。"
    Read-Host "按回车键关闭"
} catch {
    Write-Host ""
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

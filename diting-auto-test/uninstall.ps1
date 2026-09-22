$ErrorActionPreference = "Stop"

$ExtensionId = "dmfabigojpaodgkkbhnceellgffalcij"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionRoot = Join-Path $env:LOCALAPPDATA "DitingExtension"
$SetupDir = Join-Path $env:LOCALAPPDATA "DitingSetup"

try {
    Write-Host ""
    Write-Host "[谛听] 正在卸载扩展与 Native Messaging..." -ForegroundColor Cyan
    $NativeUninstaller = Join-Path $ScriptDir "native\uninstall.ps1"
    if (Test-Path $NativeUninstaller) {
        & $NativeUninstaller
    } else {
        $RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.diting.feishu_bridge"
        if (Test-Path $RegistryPath) {
            Remove-Item -Recurse -Force $RegistryPath
        }
        $BridgeDir = Join-Path $env:LOCALAPPDATA "DitingBridge"
        if (Test-Path $BridgeDir) {
            Remove-Item -Recurse -Force $BridgeDir
        }
    }

    $ChromeCandidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    $ChromePath = $ChromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($ChromePath) {
        Start-Process -FilePath $ChromePath -ArgumentList "chrome://extensions/"
    }

    Write-Host ""
    Write-Host "Chrome 个人版要求用户确认删除扩展："
    Write-Host "  1. 在刚打开的扩展程序页找到“百应直播数据采集”"
    Write-Host "  2. 点击“移除”（扩展 ID：$ExtensionId）"
    Read-Host "移除完成后按回车键继续"

    if (Test-Path $ExtensionRoot) {
        Remove-Item -Recurse -Force $ExtensionRoot
    }
    if (Test-Path $SetupDir) {
        Remove-Item -Recurse -Force $SetupDir
    }

    Write-Host ""
    Write-Host "[完成] Native Messaging、扩展文件和安装状态已删除。" -ForegroundColor Green
    Write-Host "[保留] Node.js、lark-cli、飞书登录状态、Google Chrome 均未删除。"
    Read-Host "按回车键关闭"
} catch {
    Write-Host ""
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

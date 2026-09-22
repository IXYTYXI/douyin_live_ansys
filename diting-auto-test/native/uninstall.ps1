$ErrorActionPreference = "Stop"

$RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.diting.feishu_bridge"
if (Test-Path $RegistryPath) {
    Remove-Item -Recurse -Force $RegistryPath
}
$InstallDir = Join-Path $env:LOCALAPPDATA "DitingBridge"
if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
}
Write-Host "谛听飞书桥接程序已卸载。"

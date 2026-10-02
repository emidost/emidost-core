# emidost APK release script (runs AFTER the EAS customer build finishes).
# Usage:  powershell -File scripts\release_apk.ps1 -ApkUrl "<EAS APK download URL>"
# Does: download the APK, create the GitHub release on emidost/emidost,
# print the download URL for the landing + QR page, and print how to fetch
# the signing SHA-256 from EAS credentials.
param(
  [Parameter(Mandatory = $true)][string] $ApkUrl,
  [string] $Tag = "v1.0.0",
  [string] $OutDir = "D:\emidost\builds"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$apkPath = Join-Path $OutDir "emidost-customer.apk"

Write-Host "> downloading APK" -ForegroundColor Cyan
curl.exe -L -o $apkPath $ApkUrl
if ($LASTEXITCODE -ne 0) { throw "APK download failed" }
Write-Host ("apk bytes: " + (Get-Item $apkPath).Length)

Write-Host "> creating GitHub release" -ForegroundColor Cyan
Set-Location D:\emidost
git -C D:\emidost fetch origin --quiet
gh release create $Tag $apkPath `
  --repo emidost/emidost `
  --title "emidost customer app $Tag" `
  --notes "Customer APK (app name: wifi). Install, then provision via the portal QR."

Write-Host ""
Write-Host "=== WIRE THESE ===" -ForegroundColor Green
Write-Host ("Landing + QR download URL:")
Write-Host "  https://github.com/emidost/emidost/releases/latest/download/emidost-customer.apk"
Write-Host ""
Write-Host "Signing SHA-256: open the EAS build page -> Credentials -> Android keystore ->"
Write-Host "copy the SHA-256 certificate fingerprint, paste into the portal QR page's"
Write-Host "PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM field."

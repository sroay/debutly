# Publishes this version of Debutly to npm. npm needs a person twice, in a real terminal: to sign
# in and to approve the publish, each in the browser. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
Set-Location (Join-Path $PSScriptRoot "..")
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "Publishing debutly $version." -ForegroundColor Cyan
Write-Host "Step 1 of 2: press Enter below. npm opens in your browser: sign in with your passkey." -ForegroundColor Cyan
npm login --auth-type=web
if ($LASTEXITCODE -ne 0) { Write-Host "Sign-in didn't finish. Run this again." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "Step 2 of 2: press Enter below, then approve the publish in the browser." -ForegroundColor Cyan
npm publish --access public --auth-type=web
if ($LASTEXITCODE -ne 0) { Write-Host "Publish didn't finish. Run this again." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "Published. Latest on npm:" -ForegroundColor Green
npm view debutly version

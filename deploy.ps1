$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Script de Deploy Direto para Netlify (Sem gastar créditos de build!)
$ConfigFile = "$PSScriptRoot\.netlify-site.json"
$PublicDir  = "$PSScriptRoot\public"
$ZipPath    = "$PSScriptRoot\deploy.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   🚀 StageTimer - Auto Deploy Online     " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($PublicDir, $ZipPath)

if (Test-Path $ConfigFile) {
  $cfg = Get-Content $ConfigFile | ConvertFrom-Json
  Write-Host "Atualizando o seu site existente: $($cfg.url) ..." -ForegroundColor Yellow
} else {
  Write-Host "Dica: Se tiver um Personal Access Token do Netlify, cole abaixo para ter URL fixa." -ForegroundColor Gray
  Write-Host "Ou pressione ENTER para abrir o Netlify Drop já com o pacote pronto!" -ForegroundColor Gray
  $token = Read-Host "Token Netlify (opcional - Enter para pular)"

  if ($token) {
    $headers = @{ "Authorization" = "Bearer $token" }
    $site = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites" -Method Post -Headers $headers
    $deploy = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$($site.id)/deploys" -Method Post -Headers $headers -ContentType "application/zip" -InFile $ZipPath
    @{ id = $site.id; url = $site.ssl_url; token = $token } | ConvertTo-Json | Set-Content $ConfigFile
    Write-Host "✅ PUBLICADO COM SUCESSO!" -ForegroundColor Green
    Write-Host "🌐 Link Oficial: $($site.ssl_url)" -ForegroundColor Green
    exit
  } else {
    Start-Process "https://app.netlify.com/drop"
    Invoke-Item $PSScriptRoot
    Write-Host "✅ Arquivo 'deploy.zip' gerado! Basta soltar na janela que abriu." -ForegroundColor Green
    exit
  }
}

if ($cfg.token) {
  $headers = @{ "Authorization" = "Bearer $($cfg.token)" }
  $deploy = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$($cfg.id)/deploys" -Method Post -Headers $headers -ContentType "application/zip" -InFile $ZipPath
  Write-Host "✅ SITE ATUALIZADO EM 1 SEGUNDO!" -ForegroundColor Green
  Write-Host "🌐 Link: $($cfg.url)" -ForegroundColor Green
}

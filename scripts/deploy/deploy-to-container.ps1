<#
.SYNOPSIS
  Send Rooman PDF from this computer to your Debian / Ubuntu container (or server) and set it up.

.EXAMPLE
  .\scripts\deploy\deploy-to-container.ps1 -Server 192.168.1.60

.PARAMETER Server
  IP address or name of the container (the address you can SSH to). Not the Proxmox address.
.PARAMETER User
  The SSH user. It must be root or be able to use sudo without a prompt. Default: root.
.PARAMETER Port
  SSH port. Default: 22.
.PARAMETER Origin
  The address people will type in the browser, for example http://192.168.1.60 or https://pdf.example.com.
  It is the one address the backend accepts requests from. Default: http://<Server>.
.PARAMETER SkipBuild
  Reuse the website already built in frontend\dist.
.PARAMETER NoRegistration
  First install only: switch off sign-up for new accounts.

Nothing is committed or pushed. Your .env (secrets) is never sent: the container creates its own.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$Origin = '',
  [switch]$SkipBuild,
  [switch]$NoRegistration
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not $Origin) { $Origin = "http://$Server" }
foreach ($cmd in 'ssh', 'scp', 'tar') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' was not found. Install the Windows 'OpenSSH Client' feature and try again." }
}

# 1. build the website here (the container does not need Node)
if (-not $SkipBuild) {
  Write-Host '==> Building the website' -ForegroundColor Cyan
  Push-Location (Join-Path $root 'frontend')
  try {
    if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE) { throw 'npm install failed' } }
    npm run build
    if ($LASTEXITCODE) { throw 'The website build failed: fix the errors above first.' }
  } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) { throw 'frontend\dist is missing. Run without -SkipBuild.' }

# 2. pack only what the server needs
Write-Host '==> Packing the project' -ForegroundColor Cyan
$archive = Join-Path ([IO.Path]::GetTempPath()) 'rooman-pdf.tar.gz'
if (Test-Path $archive) { Remove-Item $archive -Force }
tar -czf $archive -C $root `
  --exclude '__pycache__' --exclude '*.pyc' --exclude '.venv' --exclude 'storage' --exclude 'tests' --exclude '.pytest_cache' `
  backend mcp-server frontend/dist scripts/deploy .env.example
if ($LASTEXITCODE) { throw 'Packing failed.' }
Write-Host ('    {0:N1} MB' -f ((Get-Item $archive).Length / 1MB))

# 3. send it and run the installer on the container
$target = "$User@$Server"
$sshOpts = @('-p', $Port)
$scpOpts = @('-P', $Port)
$sudo = if ($User -eq 'root') { '' } else { 'sudo ' }
$regFlag = if ($NoRegistration) { '--no-registration' } else { '' }

Write-Host "==> Connecting to $target (you may be asked for the password)" -ForegroundColor Cyan
scp @scpOpts $archive "${target}:/tmp/rooman-pdf.tar.gz"
if ($LASTEXITCODE) { throw "Could not copy to $target. Is SSH running in the container, and is the address right?" }

$remote = @"
set -e
${sudo}mkdir -p /opt/rooman-pdf
${sudo}tar -xzf /tmp/rooman-pdf.tar.gz -C /opt/rooman-pdf
rm -f /tmp/rooman-pdf.tar.gz
${sudo}bash /opt/rooman-pdf/scripts/deploy/install-debian.sh --origin '$Origin' $regFlag
"@
$remote = $remote -replace "`r", ''
ssh -t @sshOpts $target $remote
if ($LASTEXITCODE) { throw 'The installer reported a problem: read the messages above.' }

Remove-Item $archive -Force -ErrorAction SilentlyContinue
Write-Host "`nDeployed. Open $Origin" -ForegroundColor Green

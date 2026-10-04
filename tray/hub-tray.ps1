Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# DPI-aware, so the icon is drawn at the tray's real size instead of 16 px scaled up.
Add-Type -Namespace HubTray -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][HubTray.Native]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()
. (Join-Path $PSScriptRoot 'icon.ps1')

$TrayDir = $PSScriptRoot
$ConfigFile = Join-Path $TrayDir 'config.json'
if (-not (Test-Path $ConfigFile)) {
  [System.Windows.Forms.MessageBox]::Show("Missing $ConfigFile. Run: claude-code-hub --tray", 'Claude Code Hub') | Out-Null
  exit 1
}
$config = Get-Content $ConfigFile -Raw | ConvertFrom-Json

# createdNew, not WaitOne: a killed tray leaves the mutex abandoned, and WaitOne then throws instead of returning false.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($false, "Local\$($config.runValue)", [ref]$createdNew)
if (-not $createdNew) { exit }

$HubDir = Split-Path $TrayDir
$RunKey = 'Registry::HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
$TrayPidFile = Join-Path $HubDir 'tray.pid'
Set-Content -Path $TrayPidFile -Value $PID
$HubFile = Join-Path $HubDir 'hub.json'
$LogFile = Join-Path $HubDir 'hub.log'
$TrayLog = Join-Path $HubDir 'tray.log'

$script:hubProc = $null
$script:hub = $null
$script:state = ''
$script:appLnk = $null

function Write-TrayLog($msg) {
  Add-Content -Path $TrayLog -Value "$(Get-Date -Format s) $msg"
}

# The hub writes hub.json once it listens; a dead pid there is a hub that is gone. Get-Process still
# returns a killed process while any handle to it is open, so HasExited is checked too.
function Get-Hub {
  if (-not (Test-Path $HubFile)) { return $null }
  $hub = Get-Content $HubFile -Raw | ConvertFrom-Json
  $proc = Get-Process -Id $hub.pid -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node' -and -not $proc.HasExited) { return $hub }
  return $null
}

# The saved node comes first: the app packages were installed with it, and a version manager may
# have switched the one on PATH since.
function Get-HubCommand {
  $hubArgs = "--hub-dir `"$HubDir`" --port $($config.port)"
  $node = if (Test-Path $config.node) { $config.node } else { (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
  if ($node -and (Test-Path $config.serverJs)) {
    return "`"$node`" `"$($config.serverJs)`" $hubArgs"
  }
  $tray.ShowBalloonTip(5000, 'Claude Code Hub', "The installed hub is gone. Starting $($config.version) with npx.", 'Warning')
  return "npx -y claude-code-hub@$($config.version) $hubArgs"
}

function Start-Hub {
  if (-not (Get-Hub)) {
    if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 5MB) { Move-Item $LogFile "$LogFile.1" -Force }
    $cmd = Get-HubCommand
    Write-TrayLog "start: $cmd"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = "/d /s /c `"$cmd >> `"$LogFile`" 2>&1`""
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $HubDir
    $script:hubProc = [System.Diagnostics.Process]::Start($psi)
  }
  Update-State
}

function Get-Token {
  (Get-Content (Join-Path $HubDir 'token') -Raw).Trim()
}

# The shutdown route lets the hub stop its tools and remove hub.json; taskkill is the fallback for a
# hub that does not answer. Killing the node tree also ends the cmd that the tray started.
function Stop-Hub {
  $hub = Get-Hub
  if ($hub) {
    Write-TrayLog "stop: pid $($hub.pid)"
    try {
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($hub.port)/api/shutdown?token=$(Get-Token)" -TimeoutSec 3 | Out-Null
      Wait-Process -Id $hub.pid -Timeout 15 -ErrorAction SilentlyContinue
    } catch {
      Write-TrayLog "shutdown request failed: $_"
    }
  }
  $id = if (Get-Hub) { $hub.pid } elseif ($script:hubProc -and -not $script:hubProc.HasExited) { $script:hubProc.Id }
  if ($id) {
    Write-TrayLog "kill: pid $id"
    & taskkill.exe /f /t /pid $id 2>&1 | Out-Null
  }
  if ($script:hubProc) {
    [void]$script:hubProc.WaitForExit(5000)
    $script:hubProc.Dispose()
    $script:hubProc = $null
  }
  if ($hub) { Wait-Process -Id $hub.pid -Timeout 5 -ErrorAction SilentlyContinue }
}

$Shell = New-Object -ComObject WScript.Shell

# Chrome and Edge put an installed app's shortcut in the Start Menu, with the app id in its arguments.
function Find-AppShortcut {
  if ($script:appLnk -and (Test-Path $script:appLnk.FullName)) { return $script:appLnk }
  $script:appLnk = $null
  $filter = if ($config.app.id) { '*.lnk' } else { "$($config.app.name).lnk" }
  foreach ($file in Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter $filter -ErrorAction SilentlyContinue) {
    $lnk = $Shell.CreateShortcut($file.FullName)
    if ($lnk.Arguments -notmatch '--app-id=(\w+)') { continue }
    if (-not $config.app.id -or $Matches[1] -eq $config.app.id) { $script:appLnk = $lnk; return $lnk }
  }
  return $null
}

# Chrome loads any URL into an app, so a hub on another port must not open in it.
function Open-Hub {
  $hub = Get-Hub
  if (-not $hub) { return }
  $url = "http://localhost:$($hub.port)/?token=$(Get-Token)"
  $app = if ($hub.port -eq $config.app.port) { Find-AppShortcut }
  if ($app) {
    Start-Process $app.TargetPath "$($app.Arguments) --app-launch-url-for-shortcuts-menu-item=`"$url`""
  } else {
    Start-Process $url
  }
}

function Get-Autostart {
  $null -ne (Get-ItemProperty $RunKey -Name $config.runValue -ErrorAction SilentlyContinue)
}

$icons = @{}
$iconSize = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width
foreach ($s in $StateColors.Keys) {
  $bmp = New-TrayBitmap $iconSize $StateColors[$s]
  $icons[$s] = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $bmp.Dispose()
}

function Get-ConfigDirName {
  try {
    $dir = (Get-Content (Join-Path $HubDir 'config.json') -Raw | ConvertFrom-Json).activeConfigDir
    if ($dir) { return Split-Path $dir -Leaf }
  } catch {}
  return $null
}

# The classic ContextMenu is a native Win32 menu, so it takes the Windows 11 menu style; ContextMenuStrip draws its own.
$tray = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenu
$miHeader = New-Object System.Windows.Forms.MenuItem 'Claude Code Hub'
$miHeader.Enabled = $false
$miOpen = New-Object System.Windows.Forms.MenuItem 'Open Hub'
$miOpen.DefaultItem = $true
$miStartStop = New-Object System.Windows.Forms.MenuItem 'Stop Hub'
$miRestart = New-Object System.Windows.Forms.MenuItem 'Restart Hub'
$miLog = New-Object System.Windows.Forms.MenuItem 'Open log'
$miAuto = New-Object System.Windows.Forms.MenuItem 'Start with Windows'
$miQuit = New-Object System.Windows.Forms.MenuItem 'Quit (stops the hub)'
foreach ($item in @($miHeader, '-', $miOpen, $miStartStop, $miRestart, '-', $miLog, $miAuto, '-', $miQuit)) {
  [void]$menu.MenuItems.Add($item)
}
$tray.ContextMenu = $menu

function Set-State($s) {
  if ($script:state -eq $s) { return }
  $script:state = $s
  $tray.Icon = $icons[$s]
  $tray.Text = "Claude Code Hub: $s"
  $miStartStop.Text = if ($s -eq 'stopped') { 'Start Hub' } else { 'Stop Hub' }
  $miOpen.Enabled = $s -eq 'running'
  $miRestart.Enabled = $s -ne 'stopped'
}

function Update-Header {
  $dot = [char]0x00B7
  $parts = @(if ($script:hub) { "Running on port $($script:hub.port)" } elseif ($script:state -eq 'starting') { 'Starting' } else { 'Stopped' })
  $name = Get-ConfigDirName
  if ($name) { $parts += $name }
  $miHeader.Text = $parts -join "  $dot  "
}

# Stop-Hub clears hubProc, so a hubProc that has exited is a hub that died on its own.
function Update-State {
  $script:hub = Get-Hub
  if ($script:hub) { Set-State 'running'; return }
  if ($script:hubProc -and -not $script:hubProc.HasExited) { Set-State 'starting'; return }
  if ($script:hubProc) {
    $script:hubProc.Dispose()
    $script:hubProc = $null
    Write-TrayLog 'hub exited'
    $tray.ShowBalloonTip(5000, 'Claude Code Hub', 'The hub stopped. Start it from the tray menu; see Open log.', 'Warning')
  }
  Set-State 'stopped'
}

$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq 'Left') { Open-Hub } })
$miOpen.add_Click({ Open-Hub })
$miStartStop.add_Click({ if ($script:state -eq 'stopped') { Start-Hub } else { Stop-Hub; Update-State } })
$miRestart.add_Click({ Stop-Hub; Start-Hub })
$miLog.add_Click({ if (Test-Path $LogFile) { Start-Process $LogFile } })
$menu.add_Popup({ $miAuto.Checked = Get-Autostart; Update-Header })
$miAuto.add_Click({
  if (Get-Autostart) { Remove-ItemProperty $RunKey -Name $config.runValue }
  else { Set-ItemProperty $RunKey -Name $config.runValue -Value "wscript.exe `"$(Join-Path $TrayDir 'launch.vbs')`"" }
})
$miQuit.add_Click({
  $timer.Stop()
  Stop-Hub
  Remove-Item $TrayPidFile -ErrorAction SilentlyContinue
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({ try { Update-State } catch { Write-TrayLog "tick: $_" } })

Set-State 'starting'
$tray.Visible = $true
try { Start-Hub } catch { Write-TrayLog "start failed: $_" }
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Dispose()

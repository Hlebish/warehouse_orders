param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'

# No message text or keystrokes are sent to Viber. Restore its window even
# when it has been minimized to the tray, then request foreground activation.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WarehouseViberWindow {
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int maximum);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint source, uint target, bool attach);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    public static IntPtr Find(int[] processes) {
        var ids = new HashSet<int>(processes);
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (!ids.Contains((int)owner) || GetWindow(window, 4) != IntPtr.Zero) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString().IndexOf("Viber", StringComparison.OrdinalIgnoreCase) < 0) return true;
            found = window;
            return !IsWindowVisible(window);
        }, IntPtr.Zero);
        return found;
    }

    public static bool Focus(IntPtr window) {
        ShowWindowAsync(window, IsIconic(window) ? 9 : 5);
        uint ignored;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
        try {
            BringWindowToTop(window);
            SetForegroundWindow(window);
        } finally {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
        return GetForegroundWindow() == window;
    }

    public static bool IsForeground(IntPtr window) { return GetForegroundWindow() == window; }
}
'@

if ($ValidateOnly) { exit 0 }

$running = @(Get-Process -Name Viber -ErrorAction SilentlyContinue)
$candidates = @()
foreach ($process in $running) {
    try { if ($process.Path) { $candidates += $process.Path } } catch { }
}
if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Viber\Viber.exe' }
if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Rakuten Viber\Viber.exe' }
if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'Rakuten Viber\Viber.exe' }
foreach ($key in @('Registry::HKEY_CURRENT_USER\Software\Classes\viber\shell\open\command', 'Registry::HKEY_LOCAL_MACHINE\Software\Classes\viber\shell\open\command')) {
    if (Test-Path $key) {
        $command = (Get-Item $key).GetValue('')
        if ($command -match '^\s*"([^"]+\.exe)"') { $candidates += $Matches[1] }
    }
}
$executable = $candidates | Where-Object { [IO.Path]::GetFileName($_) -ieq 'Viber.exe' -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if ($executable) {
    # A second launch also asks a tray-only instance to restore its main window.
    Start-Process -FilePath $executable | Out-Null
} elseif ($running.Count -eq 0) {
    throw 'Viber is not installed.'
}

$focused = $false
$activator = $null
try { $activator = New-Object -ComObject WScript.Shell } catch { }
for ($attempt = 0; $attempt -lt 24; $attempt++) {
    $running = @(Get-Process -Name Viber -ErrorAction SilentlyContinue)
    $window = [WarehouseViberWindow]::Find([int[]]@($running | ForEach-Object { $_.Id }))
    if ($window -ne [IntPtr]::Zero) {
        $focused = [WarehouseViberWindow]::Focus($window)
        if (-not $focused -and $activator) {
            foreach ($process in $running) { $null = $activator.AppActivate($process.Id) }
            $focused = [WarehouseViberWindow]::IsForeground($window)
        }
        if ($focused) { break }
    }
    Start-Sleep -Milliseconds 150
}
@{ opened = ($running.Count -gt 0); focused = $focused } | ConvertTo-Json -Compress

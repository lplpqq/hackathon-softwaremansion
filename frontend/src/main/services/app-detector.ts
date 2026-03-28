import { execFile } from "child_process";
import { AppContext } from "../types";

const MACOS_APPLESCRIPT = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set bundleId to bundle identifier of frontApp
  set windowTitle to ""
  try
    set windowTitle to name of front window of frontApp
  end try
  return appName & "\t" & bundleId & "\t" & windowTitle
end tell
`;

const WINDOWS_POWERSHELL_SCRIPT = [
  'Add-Type @"',
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "public static class Win32 {",
  '  [DllImport("user32.dll")]',
  "  public static extern IntPtr GetForegroundWindow();",
  "",
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)]',
  "  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
  "",
  '  [DllImport("user32.dll")]',
  "  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
  "}",
  '"@',
  "",
  "$handle = [Win32]::GetForegroundWindow()",
  "if ($handle -eq [IntPtr]::Zero) {",
  '  Write-Output "`t`t"',
  "  exit 0",
  "}",
  "",
  "$buffer = New-Object System.Text.StringBuilder 1024",
  "[void][Win32]::GetWindowText($handle, $buffer, $buffer.Capacity)",
  "$processId = 0",
  "[void][Win32]::GetWindowThreadProcessId($handle, [ref]$processId)",
  "",
  "try {",
  "  $process = Get-Process -Id $processId -ErrorAction Stop",
  "  $appName = $process.ProcessName",
  '  $bundleId = if ($process.Path) { $process.Path } else { $process.ProcessName }',
  '  Write-Output ($appName + "`t" + $bundleId + "`t" + $buffer.ToString())',
  "} catch {",
  '  Write-Output ("Unknown`t`t" + $buffer.ToString())',
  "}",
].join("\n");

export function detectFrontmostApp(): Promise<AppContext> {
  if (process.platform === "win32") {
    return detectFrontmostWindowsApp();
  }

  if (process.platform === "darwin") {
    return detectFrontmostMacApp();
  }

  return Promise.resolve({
    appName: "Unsupported OS",
    bundleId: "",
    windowTitle: "",
    timestamp: Date.now(),
  });
}

function detectFrontmostMacApp(): Promise<AppContext> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", MACOS_APPLESCRIPT],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          resolve({
            appName: "Unknown",
            bundleId: "",
            windowTitle: "",
            timestamp: Date.now(),
          });
          return;
        }

        const parts = stdout.trim().split("\t");
        resolve({
          appName: parts[0] || "Unknown",
          bundleId: parts[1] || "",
          windowTitle: parts[2] || "",
          timestamp: Date.now(),
        });
      }
    );
  });
}

function detectFrontmostWindowsApp(): Promise<AppContext> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_POWERSHELL_SCRIPT],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          resolve({
            appName: "Unknown",
            bundleId: "",
            windowTitle: "",
            timestamp: Date.now(),
          });
          return;
        }

        const parts = stdout.trim().split("\t");
        resolve({
          appName: parts[0] || "Unknown",
          bundleId: parts[1] || "",
          windowTitle: parts[2] || "",
          timestamp: Date.now(),
        });
      }
    );
  });
}

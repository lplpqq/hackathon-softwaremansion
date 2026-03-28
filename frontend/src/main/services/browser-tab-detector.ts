import { execFile } from "child_process";
import path from "path";
import { BrowserTabInfo } from "../types";

interface BrowserConfig {
  name: string;
  script: string;
}

interface WindowsBrowserConfig {
  name: string;
}

const MACOS_BROWSER_CONFIGS: Record<string, BrowserConfig> = {
  "com.google.Chrome": {
    name: "Chrome",
    script: `tell application "Google Chrome" to return (URL of active tab of front window) & "\t" & (title of active tab of front window)`,
  },
  "com.apple.Safari": {
    name: "Safari",
    script: `tell application "Safari" to return (URL of front document) & "\t" & (name of front document)`,
  },
  "company.thebrowser.Browser": {
    name: "Arc",
    script: `tell application "Arc" to return (URL of active tab of front window) & "\t" & (title of active tab of front window)`,
  },
  "com.brave.Browser": {
    name: "Brave",
    script: `tell application "Brave Browser" to return (URL of active tab of front window) & "\t" & (title of active tab of front window)`,
  },
};

const WINDOWS_BROWSER_CONFIGS: Record<string, WindowsBrowserConfig> = {
  "chrome.exe": { name: "Chrome" },
  "msedge.exe": { name: "Edge" },
  "brave.exe": { name: "Brave" },
};

const WINDOWS_BROWSER_TAB_SCRIPT = [
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  'Add-Type @"',
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class Win32 {",
  '  [DllImport("user32.dll")]',
  "  public static extern IntPtr GetForegroundWindow();",
  "}",
  '"@',
  "",
  "$handle = [Win32]::GetForegroundWindow()",
  "if ($handle -eq [IntPtr]::Zero) {",
  '  Write-Output "`t"',
  "  exit 0",
  "}",
  "",
  "$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)",
  "if ($null -eq $root) {",
  '  Write-Output "`t"',
  "  exit 0",
  "}",
  "",
  "$conditions = New-Object System.Windows.Automation.AndCondition(",
  "  (New-Object System.Windows.Automation.PropertyCondition(",
  "    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,",
  "    [System.Windows.Automation.ControlType]::Edit",
  "  )),",
  "  (New-Object System.Windows.Automation.PropertyCondition(",
  "    [System.Windows.Automation.AutomationElement]::IsControlElementProperty,",
  "    $true",
  "  ))",
  ")",
  "",
  "$addressBar = $root.FindFirst(",
  "  [System.Windows.Automation.TreeScope]::Descendants,",
  "  $conditions",
  ")",
  "",
  "if ($null -eq $addressBar) {",
  '  Write-Output "`t"',
  "  exit 0",
  "}",
  "",
  "try {",
  "  $valuePattern = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)",
  "  $url = $valuePattern.Current.Value",
  "  $title = $root.Current.Name",
  '  Write-Output ($url + "`t" + $title)',
  "} catch {",
  '  Write-Output "`t"',
  "}",
].join("\n");

const warnedBrowsers = new Set<string>();

export function isSupportedBrowser(bundleId: string): boolean {
  if (process.platform === "darwin") {
    return bundleId in MACOS_BROWSER_CONFIGS;
  }

  if (process.platform === "win32") {
    return getWindowsBrowserConfig(bundleId) !== null;
  }

  return false;
}

export function detectBrowserTab(
  bundleId: string
): Promise<BrowserTabInfo | null> {
  if (process.platform === "darwin") {
    return detectMacBrowserTab(bundleId);
  }

  if (process.platform === "win32") {
    return detectWindowsBrowserTab(bundleId);
  }

  return Promise.resolve(null);
}

function detectMacBrowserTab(bundleId: string): Promise<BrowserTabInfo | null> {
  const config = MACOS_BROWSER_CONFIGS[bundleId];
  if (!config) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", config.script],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          if (!warnedBrowsers.has(bundleId)) {
            warnedBrowsers.add(bundleId);
            console.warn(
              `[browser-tab] Cannot read tabs from ${config.name}. ` +
                `Grant automation permission in System Preferences > Privacy > Automation.`
            );
          }
          resolve(null);
          return;
        }

        const parts = stdout.trim().split("\t");
        if (parts.length < 2 || !parts[0]) {
          resolve(null);
          return;
        }

        resolve({
          url: parts[0],
          title: parts[1] || "",
          browserName: config.name,
        });
      }
    );
  });
}

function detectWindowsBrowserTab(
  bundleId: string
): Promise<BrowserTabInfo | null> {
  const config = getWindowsBrowserConfig(bundleId);
  if (!config) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_BROWSER_TAB_SCRIPT],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          warnWindowsBrowser(bundleId, config.name);
          resolve(null);
          return;
        }

        const parts = stdout.trim().split("\t");
        if (parts.length < 1 || !parts[0] || !isProbablyUrl(parts[0])) {
          warnWindowsBrowser(bundleId, config.name);
          resolve(null);
          return;
        }

        resolve({
          url: parts[0],
          title: parts[1] || "",
          browserName: config.name,
        });
      }
    );
  });
}

function getWindowsBrowserConfig(
  bundleId: string
): WindowsBrowserConfig | null {
  const executableName = path.win32.basename(bundleId || "").toLowerCase();
  return WINDOWS_BROWSER_CONFIGS[executableName] ?? null;
}

function warnWindowsBrowser(bundleId: string, browserName: string): void {
  if (warnedBrowsers.has(bundleId)) {
    return;
  }

  warnedBrowsers.add(bundleId);
  console.warn(
    `[browser-tab] Cannot read tabs from ${browserName} on Windows. ` +
      `If needed, launch the browser with --force-renderer-accessibility so UI Automation can inspect the address bar.`
  );
}

function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol && url.hostname);
  } catch {
    return false;
  }
}

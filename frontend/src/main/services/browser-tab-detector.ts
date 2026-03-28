import { execFile } from "child_process";
import { BrowserTabInfo } from "../types";

interface BrowserConfig {
  name: string;
  script: string;
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

const warnedBrowsers = new Set<string>();

export function isSupportedBrowser(bundleId: string): boolean {
  return process.platform === "darwin" && bundleId in MACOS_BROWSER_CONFIGS;
}

export function detectBrowserTab(
  bundleId: string
): Promise<BrowserTabInfo | null> {
  if (process.platform !== "darwin") {
    return Promise.resolve(null);
  }

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

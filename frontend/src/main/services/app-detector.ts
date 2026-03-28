import { execFile } from "child_process";
import { AppContext } from "../types";

const APPLESCRIPT = `
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

export function detectFrontmostApp(): Promise<AppContext> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", APPLESCRIPT],
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

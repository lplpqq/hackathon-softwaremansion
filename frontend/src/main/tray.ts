import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";

export interface TrayActions {
  onToggleOverlay: () => void;
  onPauseDetection: () => void;
  onResumeDetection: () => void;
  isOverlayVisible: () => boolean;
  isDetectionRunning: () => boolean;
}

export function createTray(actions: TrayActions): Tray {
  const iconPath = path.join(
    app.getAppPath(),
    "src",
    "main",
    "assets",
    "iconTemplate.png"
  );
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  const tray = new Tray(icon);
  tray.setToolTip("Authently");

  function rebuildMenu() {
    const overlayVisible = actions.isOverlayVisible();
    const detecting = actions.isDetectionRunning();

    const contextMenu = Menu.buildFromTemplate([
      {
        label: overlayVisible ? "Hide Overlay" : "Show Overlay",
        click: () => {
          actions.onToggleOverlay();
          rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: detecting ? "Pause Detection" : "Resume Detection",
        click: () => {
          if (detecting) {
            actions.onPauseDetection();
          } else {
            actions.onResumeDetection();
          }
          rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit Authently",
        click: () => app.quit(),
      },
    ]);

    tray.setContextMenu(contextMenu);
  }

  rebuildMenu();
  tray.on("click", () => {
    actions.onToggleOverlay();
    rebuildMenu();
  });

  return tray;
}

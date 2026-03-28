import { useEffect, useRef, useCallback } from "react";
import { useConnection, useCustomSource } from "@fishjam-cloud/react-client";
import { connectAnalysisWs } from "../services/analysis-ws";
import type { LiveAnalysis } from "../types";

interface UseFishjamAudioOptions {
  active: boolean;
  startToken: number;
  onAnalysis: (msg: LiveAnalysis) => void;
  onError?: (err: string) => void;
}

export function useFishjamAudio({
  active,
  startToken,
  onAnalysis,
  onError,
}: UseFishjamAudioOptions) {
  const { joinRoom, leaveRoom, peerStatus, reconnectionStatus } =
    useConnection();
  const { setStream } = useCustomSource("desktop-audio");

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastStartedTokenRef = useRef(0);
  const startInFlightRef = useRef(false);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);

  // Keep callbacks in refs so start/cleanup are stable across renders
  const onAnalysisRef = useRef(onAnalysis);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onAnalysisRef.current = onAnalysis;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    console.log("[useFishjamAudio] Fishjam state", {
      peerStatus,
      reconnectionStatus,
    });
  }, [peerStatus, reconnectionStatus]);

  const formatUnknownError = useCallback((err: unknown): string => {
    if (err instanceof Error) {
      return err.message;
    }

    if (typeof err === "string") {
      return err;
    }

    if (err && typeof err === "object") {
      try {
        return JSON.stringify(err);
      } catch {
        return "Unknown object error";
      }
    }

    if (err === undefined) {
      return "Unknown error (received undefined)";
    }

    if (err === null) {
      return "Unknown error (received null)";
    }

    return String(err);
  }, []);

  const listAudioInputDeviceLabels = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();

    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => device.label || "(hidden label)")
      .filter((label, index, labels) => labels.indexOf(label) === index);
  }, []);

  const getVirtualSystemAudioStream = useCallback(async () => {
    const findVirtualAudioDevice = (devices: MediaDeviceInfo[]) =>
      devices.find(
        (device) =>
          device.kind === "audioinput" &&
          /blackhole|soundflower|loopback|background music|vb-cable/i.test(
            device.label,
          ),
      );

    let devices = await navigator.mediaDevices.enumerateDevices();
    let virtualDevice = findVirtualAudioDevice(devices);

    if (!virtualDevice) {
      const labelProbeStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      labelProbeStream.getTracks().forEach((track) => track.stop());

      devices = await navigator.mediaDevices.enumerateDevices();
      virtualDevice = findVirtualAudioDevice(devices);
    }

    if (!virtualDevice) {
      const audioInputLabels = await listAudioInputDeviceLabels();
      console.log("[useFishjamAudio] available audio inputs", audioInputLabels);
      throw new Error(
        "macOS system audio capture is unavailable. Install a virtual audio device like BlackHole, Soundflower, Loopback, or Background Music, route system output into it, then retry.",
      );
    }

    console.log("[useFishjamAudio] using virtual audio device", virtualDevice.label);

    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: virtualDevice.deviceId },
      },
      video: false,
    });
  }, [listAudioInputDeviceLabels]);

  const getMacOsSystemAudioStream = useCallback(
    async ({
      isPackaged,
      canAttemptNativeCapture,
    }: {
      isPackaged: boolean;
      canAttemptNativeCapture: boolean;
    }) => {
      if (canAttemptNativeCapture) {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              suppressLocalAudioPlayback: false,
            },
            // @ts-expect-error Chromium display-capture hints are not in TS yet.
            systemAudio: "include",
            // @ts-expect-error Chromium display-capture hints are not in TS yet.
            windowAudio: "system",
          });

          const audioTracks = displayStream.getAudioTracks();
          const videoTracks = displayStream.getVideoTracks();

          if (audioTracks.length > 0) {
            console.log("[useFishjamAudio] using native macOS system audio track");
            videoTracks.forEach((track) => track.stop());
            return new MediaStream(audioTracks);
          }

          displayStream.getTracks().forEach((track) => track.stop());
          console.warn(
            "[useFishjamAudio] macOS display capture returned no audio tracks",
          );
        } catch (error) {
          console.warn("[useFishjamAudio] display-media audio capture failed", error);
        }
      } else {
        console.warn(
          "[useFishjamAudio] screen permission is not granted, skipping native display capture and trying virtual audio device",
        );
      }

      try {
        return await getVirtualSystemAudioStream();
      } catch (virtualDeviceError) {
        if (isPackaged) {
          throw virtualDeviceError;
        }

        throw new Error(
          "macOS returned no native system-audio track, and no virtual audio device was available. In dev, either grant Screen & System Audio Recording and restart the app, or install BlackHole/Loopback and retry.",
        );
      }
    },
    [getVirtualSystemAudioStream],
  );

  const cleanup = useCallback(async () => {
    if (cleanupPromiseRef.current) {
      return cleanupPromiseRef.current;
    }

    const cleanupPromise = (async () => {
      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      await setStream(null);

      try {
        await leaveRoom();
      } catch {
        // already disconnected
      } finally {
        startInFlightRef.current = false;
      }
    })();

    cleanupPromiseRef.current = cleanupPromise;

    try {
      await cleanupPromise;
    } finally {
      cleanupPromiseRef.current = null;
    }
  }, [leaveRoom, setStream]);

  const start = useCallback(async () => {
    if (startInFlightRef.current) {
      console.log("[useFishjamAudio] start skipped because capture is in flight");
      return;
    }

    startInFlightRef.current = true;

    try {
      if (cleanupPromiseRef.current) {
        await cleanupPromiseRef.current;
      }

      const captureSupport =
        await window.electronAPI.getSystemAudioCaptureSupport();

      if (!captureSupport.supported) {
        throw new Error(
          `System audio capture is not supported on ${captureSupport.platform}.`,
        );
      }

      console.log("[useFishjamAudio] requesting desktop media stream");
      const stream = await getMacOsSystemAudioStream({
        isPackaged: captureSupport.isPackaged,
        canAttemptNativeCapture:
          captureSupport.screenAccessStatus === "granted" ||
          captureSupport.screenAccessStatus === "not-determined",
      });
      streamRef.current = stream;

      console.log("[useFishjamAudio] creating session");
      const session = await window.electronAPI.createSession();
      console.log("[useFishjamAudio] session created", {
        hasPeerToken: Boolean(session?.peer_token),
        wsUrl: session?.ws_url,
        sessionId: session?.session_id,
        roomId: session?.room_id,
      });

      if (!session?.peer_token) {
        throw new Error("createSession returned no peer_token");
      }

      if (!session?.ws_url) {
        throw new Error("createSession returned no ws_url");
      }

      console.log("[useFishjamAudio] joining Fishjam room");
      try {
        await joinRoom({ peerToken: session.peer_token });
      } catch (joinError) {
        console.error("[useFishjamAudio] joinRoom context", {
          peerStatus,
          reconnectionStatus,
          hasPeerToken: Boolean(session.peer_token),
          fishjamId: import.meta.env.VITE_FISHJAM_ID,
        });
        throw new Error(
          `joinRoom failed: ${formatUnknownError(joinError)}`,
        );
      }
      console.log("[useFishjamAudio] joined Fishjam room");

      console.log("[useFishjamAudio] setting Fishjam custom stream");
      await setStream(stream);
      console.log("[useFishjamAudio] custom stream set");

      console.log("[useFishjamAudio] connecting analysis websocket");
      const ws = connectAnalysisWs(session.ws_url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data =
            typeof event.data === "string"
              ? event.data
              : JSON.stringify(event.data);
          onAnalysisRef.current({ text: data, timestamp: Date.now() });
        } catch {
          onAnalysisRef.current({
            text: String(event.data),
            timestamp: Date.now(),
          });
        }
      };

      ws.onerror = (err) => {
        console.error("[analysis-ws] error", err);
        onErrorRef.current?.("Analysis WebSocket error");
      };

      ws.onclose = () => {
        console.log("[analysis-ws] closed");
      };
    } catch (err) {
      const msg = formatUnknownError(err);
      console.error("[useFishjamAudio] start failed:", err);
      onErrorRef.current?.(msg);
      await cleanup();
      return;
    }

    startInFlightRef.current = false;
  }, [
    joinRoom,
    setStream,
    cleanup,
    formatUnknownError,
    getMacOsSystemAudioStream,
    peerStatus,
    reconnectionStatus,
  ]);

  useEffect(() => {
    if (!active) {
      lastStartedTokenRef.current = 0;
      cleanup();
      return;
    }

    if (startToken > 0 && startToken !== lastStartedTokenRef.current) {
      lastStartedTokenRef.current = startToken;
      start();
    }
  }, [active, startToken, start, cleanup]);

  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

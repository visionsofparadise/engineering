import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadAudio } from "./data/audioLoader";
import type { AudioData } from "@e9g/design-system";

const AudioDataContext = createContext<AudioData | null>(null);

export function AudioDataProvider({ children }: { readonly children: ReactNode }) {
  const [audioData, setAudioData] = useState<AudioData | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadAudio("/test-voice.wav").then((data) => {
      if (!cancelled) setAudioData(data);
    });

    return () => { cancelled = true; };
  }, []);

  return (
    <AudioDataContext.Provider value={audioData}>
      {children}
    </AudioDataContext.Provider>
  );
}

export function useAudioData(): AudioData | null {
  return useContext(AudioDataContext);
}

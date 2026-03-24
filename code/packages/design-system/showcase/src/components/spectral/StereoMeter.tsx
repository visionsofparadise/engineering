interface StereoMeterProps {
  readonly className?: string;
}

// Exact lava colormap stops from spectral-display, evenly spaced in dB
const METER_FILL = "linear-gradient(to top, rgb(0,0,0) 0%, rgb(5,5,30) 9.1%, rgb(15,20,70) 18.2%, rgb(30,15,50) 27.3%, rgb(80,10,5) 36.4%, rgb(140,20,0) 45.5%, rgb(185,55,0) 54.5%, rgb(215,100,5) 63.6%, rgb(240,155,25) 72.7%, rgb(252,210,70) 81.8%, rgb(255,240,140) 90.9%, rgb(255,255,255) 100%)";
const TRACK_COLOR = "#1E1E23";
const FADER_LEVEL = 85;
const LEVEL_L = 82;
const LEVEL_R = 75;

export function StereoMeter({ className }: StereoMeterProps) {
  return (
    <div className={`relative flex h-full items-end justify-center gap-1 ${className ?? ""}`}>
      <div className="relative h-full w-[3px]" style={{ backgroundColor: TRACK_COLOR }}>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${LEVEL_L}%`, background: METER_FILL }}
        />
      </div>
      <div className="relative h-full w-[3px]" style={{ backgroundColor: TRACK_COLOR }}>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${LEVEL_R}%`, background: METER_FILL }}
        />
      </div>
      {/* Gain fader thumb */}
      <div
        className="absolute left-1/2 h-[3px] w-[18px] -translate-x-1/2 bg-chrome-text"
        style={{ bottom: `${FADER_LEVEL}%` }}
      />
    </div>
  );
}

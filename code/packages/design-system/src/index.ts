/* eslint-disable barrel-files/avoid-barrel-files */
// Components — Controls
export { Knob } from "./components/controls/Knob";
export { Fader } from "./components/controls/Fader";
export { Meter } from "./components/controls/Meter";
export { ButtonSelection } from "./components/controls/ButtonSelection";

// Components — Primitives
export { Button } from "./components/Button";
export type { ButtonProps } from "./components/Button";
export { Input } from "./components/Input";
export type { InputProps } from "./components/Input";
export { Select } from "./components/Select";
export type { SelectProps } from "./components/Select";
export { DropdownButton } from "./components/DropdownButton";
export type { DropdownButtonProps, MenuItem } from "./components/DropdownButton";
export { IconButton } from "./components/IconButton";
export { AppTabBar } from "./components/AppTabBar";
export type { AppTabBarProps } from "./components/AppTabBar";
export { TerrainShader } from "./components/TerrainShader";

// Graph
export { AudioNode } from "./components/graph/AudioNode";
export { AudioEdge } from "./components/graph/AudioEdge";
export { NodeContextMenu } from "./components/graph/NodeContextMenu";
export { NodeSnapshot } from "./components/graph/NodeSnapshot";
export type { AudioNodeData, Parameter, NumberParameter, BooleanParameter, EnumParameter, StringParameter, NodeState, NodeCategory } from "./components/graph/types";

// Spectral
export { Spectrogram } from "./components/spectral/Spectrogram";
export { Waveform } from "./components/spectral/Waveform";
export { FrequencyAxis, DbAxis, ColormapGradient, TimeRuler } from "./components/spectral/Axes";
export { FrequencyMinimap } from "./components/spectral/FrequencyMinimap";
export { LoudnessOverlay } from "./components/spectral/LoudnessOverlay";
export { LoudnessKey } from "./components/spectral/LoudnessKey";
export { Minimap } from "./components/spectral/Minimap";
export { NodeNav } from "./components/spectral/NodeNav";
export { Selection } from "./components/spectral/Selection";
export { StereoMeter } from "./components/spectral/StereoMeter";
export { Transport } from "./components/spectral/Transport";
export { ZoomSliders } from "./components/spectral/ZoomSliders";
export type { AudioDisplayData, WaveformFrame, LoudnessData, AudioData } from "./components/spectral/types";

// Colors & Theme
export { THEME_COLORS, COLORMAP_POINTS, colormapGradient, getThemeColors } from "./colors";
export type { ColormapTheme, ColormapThemeColors } from "./colors";
export { lavaColormap, viridisColormap } from "./colormaps";

// Utilities
export { cn } from "./cn";

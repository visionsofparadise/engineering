import { useState } from "react";
import { Button } from "../../ui/button";
import { ButtonBank } from "../../ui/button-bank";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Label } from "../../ui/label";

export interface ExportSettings {
	format: "wav" | "flac" | "mp3" | "aac";
	bitDepth?: "16" | "24" | "32" | "32f";
	bitrate?: string;
	vbr?: number;
}

type Mp3Mode = "cbr" | "vbr";

const CBR_BITRATES = ["128k", "160k", "192k", "224k", "256k", "320k"] as const;
const AAC_BITRATES = ["64k", "96k", "128k", "160k", "192k", "256k", "320k"] as const;
const VBR_QUALITIES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

interface ExportModalProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onExport: (settings: ExportSettings) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ open, onOpenChange, onExport }) => {
	const [format, setFormat] = useState<ExportSettings["format"]>("wav");
	const [bitDepth, setBitDepth] = useState<"16" | "24" | "32" | "32f">("24");
	const [mp3Mode, setMp3Mode] = useState<Mp3Mode>("cbr");
	const [bitrate, setBitrate] = useState("192k");
	const [vbrQuality, setVbrQuality] = useState("2");
	const [aacBitrate, setAacBitrate] = useState("192k");

	const handleExport = () => {
		const settings: ExportSettings = { format };

		switch (format) {
			case "wav":
				settings.bitDepth = bitDepth;
				break;
			case "flac":
				settings.bitDepth = bitDepth === "32" || bitDepth === "32f" ? "24" : bitDepth;
				break;
			case "mp3":
				if (mp3Mode === "cbr") {
					settings.bitrate = bitrate;
				} else {
					settings.vbr = Number(vbrQuality);
				}
				break;
			case "aac":
				settings.bitrate = aacBitrate;
				break;
		}

		onExport(settings);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Export Audio</DialogTitle>
				</DialogHeader>

				<div className="form-grid py-2">
					<div className="grid gap-2">
						<Label>Format</Label>
						<ButtonBank
							value={format}
							onValueChange={(value) => setFormat(value as ExportSettings["format"])}
							options={["wav", "flac", "mp3", "aac"]}
						/>
					</div>

					{format === "wav" && (
						<div className="grid gap-2">
							<Label>Bit Depth</Label>
							<ButtonBank
								value={bitDepth}
								onValueChange={(value) => setBitDepth(value as typeof bitDepth)}
								options={["16", "24", "32", "32f"]}
							/>
						</div>
					)}

					{format === "flac" && (
						<div className="grid gap-2">
							<Label>Bit Depth</Label>
							<ButtonBank
								value={bitDepth === "32" || bitDepth === "32f" ? "24" : bitDepth}
								onValueChange={(value) => setBitDepth(value as typeof bitDepth)}
								options={["16", "24"]}
							/>
						</div>
					)}

					{format === "mp3" && (
						<>
							<div className="grid gap-2">
								<Label>Mode</Label>
								<ButtonBank
									value={mp3Mode}
									onValueChange={(value) => setMp3Mode(value as Mp3Mode)}
									options={["cbr", "vbr"]}
								/>
							</div>

							{mp3Mode === "cbr" ? (
								<div className="grid gap-2">
									<Label>Bitrate</Label>
									<ButtonBank
										value={bitrate}
										onValueChange={setBitrate}
										options={[...CBR_BITRATES]}
									/>
								</div>
							) : (
								<div className="grid gap-2">
									<Label>Quality (0 = best, 9 = smallest)</Label>
									<ButtonBank
										value={vbrQuality}
										onValueChange={setVbrQuality}
										options={[...VBR_QUALITIES]}
									/>
								</div>
							)}
						</>
					)}

					{format === "aac" && (
						<div className="grid gap-2">
							<Label>Bitrate</Label>
							<ButtonBank
								value={aacBitrate}
								onValueChange={setAacBitrate}
								options={[...AAC_BITRATES]}
							/>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleExport}>
						Export
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

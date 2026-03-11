import { useState } from "react";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Label } from "../../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";

export interface ExportSettings {
	format: "wav" | "flac" | "mp3" | "aac";
	bitDepth?: "16" | "24" | "32" | "32f";
	bitrate?: string;
	vbr?: number;
}

type Mp3Mode = "cbr" | "vbr";

const CBR_BITRATES = ["128k", "160k", "192k", "224k", "256k", "320k"] as const;
const AAC_BITRATES = ["64k", "96k", "128k", "160k", "192k", "256k", "320k"] as const;
const VBR_QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

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
	const [vbrQuality, setVbrQuality] = useState(2);
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
					settings.vbr = vbrQuality;
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

				<div className="grid gap-4 py-2">
					<div className="grid gap-2">
						<Label>Format</Label>
						<div className="flex gap-1">
							{(["wav", "flac", "mp3", "aac"] as const).map((fmt) => (
								<Button
									key={fmt}
									variant={format === fmt ? "default" : "outline"}
									size="sm"
									className="flex-1 uppercase"
									onClick={() => setFormat(fmt)}
								>
									{fmt}
								</Button>
							))}
						</div>
					</div>

					{format === "wav" && (
						<div className="grid gap-2">
							<Label>Bit Depth</Label>
							<Select value={bitDepth} onValueChange={(value) => setBitDepth(value as typeof bitDepth)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="16">16-bit</SelectItem>
									<SelectItem value="24">24-bit</SelectItem>
									<SelectItem value="32">32-bit</SelectItem>
									<SelectItem value="32f">32-bit float</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{format === "flac" && (
						<div className="grid gap-2">
							<Label>Bit Depth</Label>
							<Select value={bitDepth === "32" || bitDepth === "32f" ? "24" : bitDepth} onValueChange={(value) => setBitDepth(value as typeof bitDepth)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="16">16-bit</SelectItem>
									<SelectItem value="24">24-bit</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{format === "mp3" && (
						<>
							<div className="grid gap-2">
								<Label>Mode</Label>
								<div className="flex gap-1">
									<Button
										variant={mp3Mode === "cbr" ? "default" : "outline"}
										size="sm"
										className="flex-1"
										onClick={() => setMp3Mode("cbr")}
									>
										CBR
									</Button>
									<Button
										variant={mp3Mode === "vbr" ? "default" : "outline"}
										size="sm"
										className="flex-1"
										onClick={() => setMp3Mode("vbr")}
									>
										VBR
									</Button>
								</div>
							</div>

							{mp3Mode === "cbr" ? (
								<div className="grid gap-2">
									<Label>Bitrate</Label>
									<Select value={bitrate} onValueChange={setBitrate}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{CBR_BITRATES.map((rate) => (
												<SelectItem key={rate} value={rate}>{rate}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							) : (
								<div className="grid gap-2">
									<Label>Quality (0 = best, 9 = smallest)</Label>
									<Select value={String(vbrQuality)} onValueChange={(value) => setVbrQuality(Number(value))}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{VBR_QUALITIES.map((quality) => (
												<SelectItem key={quality} value={String(quality)}>{quality}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</>
					)}

					{format === "aac" && (
						<div className="grid gap-2">
							<Label>Bitrate</Label>
							<Select value={aacBitrate} onValueChange={setAacBitrate}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{AAC_BITRATES.map((rate) => (
										<SelectItem key={rate} value={rate}>{rate}</SelectItem>
									))}
								</SelectContent>
							</Select>
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

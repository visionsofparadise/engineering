import { useState } from "react";
import { Input } from "../../../ui/input";
import { Label } from "../../../ui/label";
import { Slider } from "../../../ui/slider";
import type { JsonSchemaProperty } from "./utils/schema";

interface NumberParameterProps {
	readonly label: string;
	readonly initialValue: number;
	readonly property: JsonSchemaProperty;
	readonly onCommit: (value: number) => void;
	readonly disabled?: boolean;
}

export const NumberParameter: React.FC<NumberParameterProps> = ({ label, initialValue, property, onCommit, disabled }) => {
	const [value, setValue] = useState(initialValue);

	const min = property.minimum;
	const max = property.maximum;
	const step = property.multipleOf;

	if (min !== undefined && max !== undefined) {
		return (
			<div className="space-y-1">
				<div className="flex items-center justify-between">
					<Label className="text-xs">{label}</Label>
					<span className="text-[10px] text-muted-foreground">{String(value)}</span>
				</div>
				<Slider
					value={[value]}
					min={min}
					max={max}
					step={step ?? 0.01}
					onValueChange={(values) => {
						if (values[0] !== undefined) setValue(values[0]);
					}}
					onValueCommit={(values) => {
						if (values[0] !== undefined) onCommit(values[0]);
					}}
					disabled={disabled}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<Label className="text-xs">{label}</Label>
			<Input
				type="number"
				value={String(value)}
				min={min}
				max={max}
				step={step}
				onChange={(event) => setValue(Number(event.target.value))}
				onBlur={() => onCommit(value)}
				className="h-7 text-xs"
				disabled={disabled}
			/>
		</div>
	);
};

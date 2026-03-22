import { useEffect, useState } from "react";
import { Input } from "../../../ui/input";
import { Label } from "../../../ui/label";

interface StringParameterProps {
	readonly label: string;
	readonly initialValue: string;
	readonly onCommit: (value: string) => void;
	readonly disabled?: boolean;
}

export const StringParameter: React.FC<StringParameterProps> = ({ label, initialValue, onCommit, disabled }) => {
	const [value, setValue] = useState(initialValue);

	useEffect(() => setValue(initialValue), [initialValue]);

	return (
		<div className="space-y-1">
			<Label className="text-xs">{label}</Label>
			<Input
				value={value}
				onChange={(event) => setValue(event.target.value)}
				onBlur={() => onCommit(value)}
				className="h-7 text-xs"
				disabled={disabled}
			/>
		</div>
	);
};

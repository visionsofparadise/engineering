import { Label } from "../../../ui/label";
import { ButtonBank } from "../../../ui/button-bank";

interface EnumParameterProps {
	readonly label: string;
	readonly initialValue: string;
	readonly values: ReadonlyArray<string>;
	readonly onCommit: (value: string) => void;
	readonly disabled?: boolean;
}

export const EnumParameter: React.FC<EnumParameterProps> = ({ label, initialValue, values, onCommit, disabled }) => (
	<div className="space-y-1">
		<Label className="text-xs">{label}</Label>
		<ButtonBank value={initialValue} onValueChange={onCommit} options={values} disabled={disabled} />
	</div>
);

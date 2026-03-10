import { Label } from "../../../ui/label";
import { Switch } from "../../../ui/switch";

interface BooleanParameterProps {
	readonly label: string;
	readonly initialValue: boolean;
	readonly onCommit: (value: boolean) => void;
	readonly disabled?: boolean;
}

export const BooleanParameter: React.FC<BooleanParameterProps> = ({ label, initialValue, onCommit, disabled }) => (
	<div className="flex items-center justify-between">
		<Label className="text-xs">{label}</Label>
		<Switch checked={initialValue} onCheckedChange={onCommit} disabled={disabled} />
	</div>
);

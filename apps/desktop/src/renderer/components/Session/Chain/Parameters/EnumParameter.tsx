import { Label } from "../../../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";

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
		<Select value={initialValue} onValueChange={onCommit} disabled={disabled}>
			<SelectTrigger className="h-7 text-xs">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{values.map((enumValue) => (
					<SelectItem key={enumValue} value={enumValue} className="text-xs">
						{enumValue}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	</div>
);

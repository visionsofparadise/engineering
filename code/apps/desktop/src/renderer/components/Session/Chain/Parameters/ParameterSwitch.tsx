import { BooleanParameter } from "./BooleanParameter";
import { EnumParameter } from "./EnumParameter";
import { NumberParameter } from "./NumberParameter";
import { StringParameter } from "./StringParameter";
import type { JsonSchemaProperty } from "./utils/schema";

interface ParameterSwitchProps {
	readonly fieldKey: string;
	readonly property: JsonSchemaProperty;
	readonly label: string;
	readonly initialValue: unknown;
	readonly onCommit: (value: unknown) => void;
	readonly disabled?: boolean;
}

export const ParameterSwitch: React.FC<ParameterSwitchProps> = ({ fieldKey, property, label, initialValue, onCommit, disabled }) => {
	if (property.type === "number") {
		return (
			<NumberParameter
				key={fieldKey}
				label={label}
				initialValue={initialValue as number}
				property={property}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	if (property.type === "boolean") {
		return (
			<BooleanParameter
				key={fieldKey}
				label={label}
				initialValue={initialValue as boolean}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	if (property.type === "string" && property.enum) {
		return (
			<EnumParameter
				key={fieldKey}
				label={label}
				initialValue={initialValue as string}
				values={[...property.enum]}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	if (property.type === "string") {
		return (
			<StringParameter
				key={fieldKey}
				label={label}
				initialValue={typeof initialValue === "string" ? initialValue : ""}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	return null;
};

import { BooleanParameter } from "./BooleanParameter";
import { EnumParameter } from "./EnumParameter";
import { NumberParameter } from "./NumberParameter";
import { StringParameter } from "./StringParameter";
import type { ZodDef } from "./utils/schema";

interface ParameterSwitchProps {
	readonly fieldKey: string;
	readonly def: ZodDef;
	readonly label: string;
	readonly initialValue: unknown;
	readonly onCommit: (value: unknown) => void;
	readonly disabled?: boolean;
}

export const ParameterSwitch: React.FC<ParameterSwitchProps> = ({ fieldKey, def, label, initialValue, onCommit, disabled }) => {
	if (def.typeName === "ZodNumber") {
		return (
			<NumberParameter
				key={fieldKey}
				label={label}
				initialValue={initialValue as number}
				def={def}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	if (def.typeName === "ZodBoolean") {
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
	if (def.typeName === "ZodEnum") {
		return (
			<EnumParameter
				key={fieldKey}
				label={label}
				initialValue={initialValue as string}
				values={def.values ?? []}
				onCommit={onCommit}
				disabled={disabled}
			/>
		);
	}
	if (def.typeName === "ZodString") {
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

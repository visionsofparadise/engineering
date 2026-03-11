export function resolveTemplate(template: string, file: { name: string; ext: string }, index: number): string {
	return template
		.replace(/\{name\}/g, file.name)
		.replace(/\{ext\}/g, file.ext)
		.replace(/\{index:(\d+)\}/g, (_, digits) => String(index).padStart(Number(digits), "0"))
		.replace(/\{index\}/g, String(index));
}

export interface LogContext {
	transactionId?: string;
	[key: string]: string | undefined;
}

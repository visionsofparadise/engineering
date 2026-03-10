import React from "react";

interface ErrorBoundaryProps {
	children: React.ReactNode;
}

interface ErrorBoundaryState {
	error: Error | undefined;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	override state: ErrorBoundaryState = { error: undefined };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	override render() {
		if (this.state.error) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-background p-8">
					<div className="max-w-md text-center">
						<h1 className="mb-2 text-xl font-bold text-destructive">Something went wrong</h1>
						<p className="text-sm text-muted-foreground">{this.state.error.message}</p>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

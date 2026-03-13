const CSP_DEV = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: http://localhost:* ws://localhost:*",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"media-src 'self' blob: data: file: media:",
	"connect-src 'self' http://localhost:* ws://localhost:*",
].join("; ");

const CSP_PROD = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-eval' blob:",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"media-src 'self' blob: data: file: media:",
	"connect-src 'self'",
].join("; ");

export const getContentSecurityPolicy = (isDev: boolean): string => (isDev ? CSP_DEV : CSP_PROD);

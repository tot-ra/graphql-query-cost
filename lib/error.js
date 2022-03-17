exports.CostValidationError = class CostValidationError extends Error {
	constructor(msg, params = {}) {
		msg = `Cost validation error: ${msg}`;

		Object.entries(params).forEach(
			([key, value]) => (msg = `${msg}\n\t${key}: ${value}`)
		);

		super(msg);
	}
};

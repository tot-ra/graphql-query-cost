module.exports = {
	rootDir: '../..',
	resetModules: true,
	resetMocks: true,
	coverageReporters: ['text', 'json', 'lcov', 'clover'],
	collectCoverage: true,
	collectCoverageFrom: ['<rootDir>/lib/**/*.js'],
	coveragePathIgnorePatterns: ['/node_modules/', '/examples/', '/coverage/'],
	testMatch: [
		'<rootDir>/test/unit/**/*.test.js',
		'<rootDir>/lib/**/*.test.js',
	],
	modulePaths: ['<rootDir>'],
};

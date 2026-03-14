module.exports = {
  testEnvironment: "node",
  testMatch: [
    "**/tests/jest/unit/**/*.jest.test.js",
    "**/tests/jest/unit/**/*.test.js",
    "**/tests/jest/integration/**/*.test.js",
  ],
  transform: {},
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Force l'arrêt du worker après les tests (évite "failed to exit gracefully"
  // causé par les setTimeout(5000) non résolus dans missionQueue.jest.test.js)
  forceExit: true,
};

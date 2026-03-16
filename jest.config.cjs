module.exports = {
  testEnvironment: "node",
  testMatch: [
    "**/tests/jest/unit/**/*.jest.test.js",
    "**/tests/jest/unit/**/*.test.js",
    "**/tests/jest/integration/**/*.test.js",
  ],
  transform: {},
  testPathIgnorePatterns: [
    // Runners autonomes avec process.exit() — exécuter via `node` directement
    "tests/jest/unit/index.test.js",
    "tests/jest/unit/mcp_routes.test.js",
  ],
  // Force l'arrêt du worker après les tests (évite "failed to exit gracefully"
  // causé par les setTimeout(5000) non résolus dans missionQueue.jest.test.js)
  forceExit: true,
};

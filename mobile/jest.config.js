module.exports = {
  preset: "react-native",
  setupFilesAfterEnv: ["./jest.setup.js"],
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
  transformIgnorePatterns: [
    "node_modules/(?!((@)?react-native|react-native-safe-area-context|react-native-svg|lucide-react-native)/)",
  ],
};

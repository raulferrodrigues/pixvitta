const signingVariables = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "GH_TOKEN"
];

const missing = signingVariables.filter((name) => !process.env[name]);
const requireSigning = process.env.PIXVITTA_REQUIRE_SIGNING === "1";

if (missing.length === 0) {
  console.log("Release environment contains signing, notarization, and GitHub publishing variables.");
  process.exit(0);
}

const message = [
  "Pixvitta release environment is missing signing/notarization variables:",
  ...missing.map((name) => `- ${name}`),
  "",
  "Unsigned local release builds are allowed right now.",
  "Set PIXVITTA_REQUIRE_SIGNING=1 to make these variables mandatory for CI/public releases."
].join("\n");

if (requireSigning) {
  console.error(message);
  process.exit(1);
}

console.warn(message);

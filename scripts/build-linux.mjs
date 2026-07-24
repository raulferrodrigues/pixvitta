import { spawn } from "node:child_process";

const flavor = process.argv[2];
const packageTarget = process.argv[3] ?? "all";

if (flavor !== "stable" && flavor !== "nightly") {
  throw new Error(
    `Build flavor must be "stable" or "nightly", received ${flavor ?? "nothing"}`
  );
}

if (packageTarget !== "all" && packageTarget !== "deb") {
  throw new Error(`Package target must be "all" or "deb", received ${packageTarget}`);
}

const targets = packageTarget === "deb" ? ["deb"] : ["AppImage", "deb"];
const args = ["--linux", ...targets, "--publish", "never"];

if (flavor === "nightly") {
  args.push(
    "--config.productName=Pixvitta Nightly",
    "--config.appId=com.raulrodrigues.pixvitta.nightly",
    "--config.executableName=pixvitta-nightly",
    "--config.extraMetadata.name=pixvitta-nightly",
    "--config.extraMetadata.productName=Pixvitta Nightly",
    "--config.extraMetadata.desktopName=pixvitta-nightly.desktop",
    "--config.linux.icon=build/icons-nightly",
    "--config.linux.desktop.entry.StartupWMClass=pixvitta-nightly",
    "--config.appImage.artifactName=Pixvitta-Nightly.AppImage",
    "--config.deb.artifactName=Pixvitta-Nightly-${version}-${arch}.${ext}",
    "--config.publish.channel=nightly"
  );
}

const builder = spawn("electron-builder", args, {
  stdio: "inherit",
  shell: false
});

builder.on("error", (error) => {
  throw error;
});

builder.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

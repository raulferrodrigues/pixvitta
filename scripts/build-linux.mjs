import { spawn } from "node:child_process";

const flavor = process.argv[2];
const packageTarget = process.argv[3] ?? "all";

if (flavor !== "stable" && flavor !== "dev") {
  throw new Error(`Build flavor must be "stable" or "dev", received ${flavor ?? "nothing"}`);
}

if (packageTarget !== "all" && packageTarget !== "deb") {
  throw new Error(`Package target must be "all" or "deb", received ${packageTarget}`);
}

const targets = packageTarget === "deb" ? ["deb"] : ["AppImage", "deb"];
const args = ["--linux", ...targets, "--publish", "never"];

if (flavor === "dev") {
  args.push(
    "--config.productName=Pixvitta Dev",
    "--config.appId=com.raulrodrigues.pixvitta.dev",
    "--config.executableName=pixvitta-dev",
    "--config.extraMetadata.name=pixvitta-dev",
    "--config.extraMetadata.productName=Pixvitta Dev",
    "--config.extraMetadata.desktopName=pixvitta-dev.desktop",
    "--config.linux.icon=build/icons-dev",
    "--config.linux.desktop.entry.StartupWMClass=pixvitta-dev",
    "--config.appImage.artifactName=Pixvitta-Dev.AppImage",
    "--config.deb.artifactName=Pixvitta-Dev-${version}-${arch}.${ext}",
    "--config.publish.channel=dev"
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

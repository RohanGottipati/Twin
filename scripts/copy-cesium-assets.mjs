import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const sourceRoot = resolve(
  process.cwd(),
  "node_modules/cesium/Build/Cesium"
);

const destinationRoot = resolve(
  process.cwd(),
  "public/cesium"
);

const directories = [
  "Workers",
  "ThirdParty",
  "Assets",
  "Widgets",
];

if (!existsSync(sourceRoot)) {
  throw new Error(
    "Cesium static assets were not found. Run npm install first."
  );
}

mkdirSync(destinationRoot, { recursive: true });

for (const directory of directories) {
  const source = resolve(sourceRoot, directory);
  const destination = resolve(destinationRoot, directory);

  rmSync(destination, {
    recursive: true,
    force: true,
  });

  cpSync(source, destination, {
    recursive: true,
  });
}

console.log("Copied Cesium static assets to public/cesium.");

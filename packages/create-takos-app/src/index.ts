import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cyan, green, red } from "kolorist";
import prompts from "prompts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log(cyan("create-takos-app"));

  const { projectName } = await prompts(
    [
      {
        type: "text",
        name: "projectName",
        message: "Project name:",
        initial: "my-takos-app"
      }
    ],
    {
      onCancel: () => {
        process.exit(1);
      }
    }
  );

  if (!projectName) {
    console.log(red("Project name is required"));
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(targetDir)) {
    console.log(red(`Directory ${projectName} already exists`));
    process.exit(1);
  }

  const templateDir = path.resolve(__dirname, "..", "template");
  copyDir(templateDir, targetDir);

  const templatePkgPath = path.join(targetDir, "package.json.template");
  const pkg = JSON.parse(fs.readFileSync(templatePkgPath, "utf-8"));
  pkg.name = projectName;
  fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2));
  fs.unlinkSync(templatePkgPath);

  console.log(green(`\nCreated ${projectName}!`));
  console.log(`\nNext steps:\n  cd ${projectName}\n  npm install\n  npm run dev`);
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    const stat = fs.statSync(srcFile);
    if (stat.isDirectory()) {
      copyDir(srcFile, destFile);
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

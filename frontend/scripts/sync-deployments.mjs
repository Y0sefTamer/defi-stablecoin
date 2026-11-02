#!/usr/bin/env node
/**
 * Reads Foundry broadcast artifacts and writes the addresses the frontend needs.
 *
 * Usage:
 *   node scripts/sync-deployments.mjs            # every chain under broadcast/DeployDSC.s.sol
 *   node scripts/sync-deployments.mjs 11155111   # only Sepolia
 *
 * Addresses are never guessed: they come from the CREATE transactions of
 * script/DeployDSC.s.sol. Env vars (NEXT_PUBLIC_DSC_ENGINE_<chainId>) still win
 * at runtime, so you can point the app at a deployment without touching this.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const broadcastDir = resolve(repoRoot, "broadcast/DeployDSC.s.sol");
const outputPath = resolve(here, "../src/config/deployments.generated.json");

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

async function listChainDirs() {
  try {
    const entries = await readdir(broadcastDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    throw new Error(
      `No broadcast artifacts at ${broadcastDir}\n` +
        `Deploy first: \`make deploy\` (Anvil) or \`make deploy ARGS="--network sepolia"\`.`,
    );
  }
}

async function readDeployment(chainDir) {
  const runPath = resolve(broadcastDir, chainDir, "run-latest.json");
  let raw;
  try {
    raw = await readFile(runPath, "utf8");
  } catch {
    return undefined;
  }

  const artifact = JSON.parse(raw);
  const receipts = new Map(
    (artifact.receipts ?? []).map((receipt) => [receipt.transactionHash, receipt]),
  );

  const created = new Map();
  for (const tx of artifact.transactions ?? []) {
    if (tx.transactionType !== "CREATE" || !tx.contractName || !tx.contractAddress) continue;
    const receipt = receipts.get(tx.hash);
    created.set(tx.contractName, {
      address: tx.contractAddress,
      blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
    });
  }

  const engine = created.get("DSCEngine");
  const dsc = created.get("DecentralizedStableCoin");
  if (!engine || !dsc) {
    throw new Error(
      `${runPath} does not contain both DSCEngine and DecentralizedStableCoin CREATE transactions`,
    );
  }

  const oracleLib = (artifact.libraries ?? [])
    .map((entry) => entry.split(":"))
    .find((parts) => parts[1] === "OracleLib");

  return {
    chainId: Number(artifact.chain),
    engine: engine.address,
    dsc: dsc.address,
    oracleLib: oracleLib?.[2],
    deploymentBlock: engine.blockNumber,
    deployer: artifact.transactions?.[0]?.transaction?.from,
    updatedAt: new Date().toISOString(),
  };
}

const chainDirs = requested.length > 0 ? requested : await listChainDirs();

const existing = await readFile(outputPath, "utf8").catch(() => "{}");
const output = JSON.parse(existing);

for (const chainDir of chainDirs) {
  const deployment = await readDeployment(chainDir);
  if (!deployment) {
    console.warn(`skipped ${chainDir}: no run-latest.json`);
    continue;
  }
  if (deployment.chainId !== Number(chainDir)) {
    throw new Error(
      `chain mismatch: directory ${chainDir} contains chain ${deployment.chainId}`,
    );
  }
  output[String(deployment.chainId)] = deployment;
  console.log(
    `chain ${deployment.chainId}: engine ${deployment.engine} ` +
      `(block ${deployment.deploymentBlock ?? "unknown"}), dsc ${deployment.dsc}`,
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`wrote ${outputPath}`);

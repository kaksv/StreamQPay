import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";
import { createConfig, injected } from "wagmi";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc-test.qday.info";

export const AEVUM_CHAIN = defineChain({
  id: 44005,
  name: "QDay Aevum Testnet",
  nativeCurrency: {
    name: "tQDAY",
    symbol: "tQDAY",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "QDay Aevum Testnet Explorer",
      url: "https://explorer-test.qday.info",
    },
  },
  testnet: true,
});

export const TUSD8_ADDRESS = getAddress(
  process.env.NEXT_PUBLIC_TUSD8_ADDRESS?.trim() ||
    "0x456569838f1d43009A91ebA4263147Afd7233483",
);

export const publicClient = createPublicClient({
  chain: AEVUM_CHAIN,
  transport: http(RPC_URL, { timeout: 12_000 }),
});

export const wagmiConfig = createConfig({
  chains: [AEVUM_CHAIN],
  connectors: [injected()],
  transports: {
    [AEVUM_CHAIN.id]: http(RPC_URL, { timeout: 12_000 }),
  },
  ssr: true,
});

export function getStreamPayAddress(): Address | null {
  const configuredAddress = process.env.NEXT_PUBLIC_STREAMPAY_ADDRESS?.trim();
  if (!configuredAddress) return null;
  if (!isAddress(configuredAddress)) {
    throw new Error("NEXT_PUBLIC_STREAMPAY_ADDRESS is not a valid EVM address.");
  }
  return getAddress(configuredAddress);
}

export function getDeploymentBlock(): bigint {
  const value = process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK?.trim();
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(
      "Set NEXT_PUBLIC_DEPLOYMENT_BLOCK to the verified StreamPay deployment block.",
    );
  }
  return BigInt(value);
}

import { getAddress, type Address, type Hex } from "viem";
import { erc20Abi, streamPayAbi } from "@/lib/abi";
import {
  getDeploymentBlock,
  getStreamPayAddress,
  publicClient,
  TUSD8_ADDRESS,
} from "@/lib/chain";

const ONE = BigInt(1);
const EVENT_BLOCK_RANGE = BigInt(2_000);
const READ_BATCH_SIZE = 20;
const HISTORY_LIMIT = 50;

export interface StreamRecord {
  id: bigint;
  sender: Address;
  recipient: Address;
  deposit: bigint;
  withdrawn: bigint;
  startTime: bigint;
  endTime: bigint;
  cancelledAt: bigint;
  cancellable: boolean;
  cancelled: boolean;
  accrued: bigint;
  available: bigint;
}

export interface ActivityRecord {
  id: bigint;
  kind: "created" | "withdrawn" | "cancelled";
  amount: bigint;
  sender: Address;
  recipient: Address;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: bigint;
}

export interface WalletData {
  streams: StreamRecord[];
  activity: ActivityRecord[];
  blockTimestamp: bigint;
  fetchedAtMs: number;
  blockNumber: bigint;
}

export async function fetchWalletData(walletAddress: Address): Promise<WalletData> {
  const contractAddress = getStreamPayAddress();
  if (!contractAddress) {
    throw new Error("Set NEXT_PUBLIC_STREAMPAY_ADDRESS to the verified StreamPay address.");
  }
  const deploymentBlock = getDeploymentBlock();
  const account = getAddress(walletAddress);
  const head = await publicClient.getBlock({ blockTag: "latest" });
  if (head.number === null) {
    throw new Error("The RPC did not return a numbered finalized block.");
  }
  if (deploymentBlock > head.number) {
    throw new Error("The configured deployment block is newer than the current Aevum block.");
  }

  const createdByWallet: Awaited<
    ReturnType<typeof publicClient.getContractEvents<typeof streamPayAbi, "StreamCreated">>
  > = [];
  const receivedCreations: typeof createdByWallet = [];
  const withdrawalsBySender: Awaited<
    ReturnType<typeof publicClient.getContractEvents<typeof streamPayAbi, "StreamWithdrawn">>
  > = [];
  const withdrawalsByRecipient: typeof withdrawalsBySender = [];
  const cancellationsBySender: Awaited<
    ReturnType<typeof publicClient.getContractEvents<typeof streamPayAbi, "StreamCancelled">>
  > = [];
  const cancellationsByRecipient: typeof cancellationsBySender = [];

  for (let fromBlock = deploymentBlock; fromBlock <= head.number; ) {
    const toBlock =
      fromBlock + EVENT_BLOCK_RANGE - ONE < head.number
        ? fromBlock + EVENT_BLOCK_RANGE - ONE
        : head.number;
    const [
      createdSent,
      createdReceived,
      withdrawnSent,
      withdrawnReceived,
      cancelledSent,
      cancelledReceived,
    ] = await Promise.all([
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamCreated",
        args: { sender: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamCreated",
        args: { recipient: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamWithdrawn",
        args: { sender: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamWithdrawn",
        args: { recipient: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamCancelled",
        args: { sender: account },
        fromBlock,
        toBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: streamPayAbi,
        eventName: "StreamCancelled",
        args: { recipient: account },
        fromBlock,
        toBlock,
      }),
    ]);
    createdByWallet.push(...createdSent);
    receivedCreations.push(...createdReceived);
    withdrawalsBySender.push(...withdrawnSent);
    withdrawalsByRecipient.push(...withdrawnReceived);
    cancellationsBySender.push(...cancelledSent);
    cancellationsByRecipient.push(...cancelledReceived);
    fromBlock = toBlock + ONE;
  }

  const creationLogs = [...createdByWallet, ...receivedCreations];
  const streamIds = [
    ...new Set(
      creationLogs
        .map((log) => log.args.streamId)
        .filter((id): id is bigint => id !== undefined),
    ),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const streams: StreamRecord[] = [];
  for (let offset = 0; offset < streamIds.length; offset += READ_BATCH_SIZE) {
    const batch = streamIds.slice(offset, offset + READ_BATCH_SIZE);
    const records = await Promise.all(
      batch.map(async (id) => {
        const [stream, accrued, available] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: streamPayAbi,
            functionName: "getStream",
            args: [id],
            blockNumber: head.number,
          }),
          publicClient.readContract({
            address: contractAddress,
            abi: streamPayAbi,
            functionName: "accruedAmount",
            args: [id],
            blockNumber: head.number,
          }),
          publicClient.readContract({
            address: contractAddress,
            abi: streamPayAbi,
            functionName: "withdrawableAmount",
            args: [id],
            blockNumber: head.number,
          }),
        ]);
        return { id, ...stream, accrued, available };
      }),
    );
    streams.push(...records);
  }

  const events: Omit<ActivityRecord, "timestamp">[] = [
    ...deduplicateLogs(creationLogs).map((log) => {
      if (
        log.args.streamId === undefined ||
        log.args.sender === undefined ||
        log.args.recipient === undefined ||
        log.args.deposit === undefined
      ) {
        throw new Error("The RPC returned an incomplete StreamCreated event.");
      }
      return normalizeEvent(log, {
        id: log.args.streamId,
        sender: log.args.sender,
        recipient: log.args.recipient,
        kind: "created",
        amount: log.args.deposit,
      });
    }),
    ...deduplicateLogs([...withdrawalsBySender, ...withdrawalsByRecipient]).map((log) => {
      if (
        log.args.streamId === undefined ||
        log.args.sender === undefined ||
        log.args.recipient === undefined ||
        log.args.amount === undefined
      ) {
        throw new Error("The RPC returned an incomplete StreamWithdrawn event.");
      }
      return normalizeEvent(log, {
        id: log.args.streamId,
        sender: log.args.sender,
        recipient: log.args.recipient,
        kind: "withdrawn",
        amount: log.args.amount,
      });
    }),
    ...deduplicateLogs([...cancellationsBySender, ...cancellationsByRecipient]).map((log) => {
      if (
        log.args.streamId === undefined ||
        log.args.sender === undefined ||
        log.args.recipient === undefined ||
        log.args.refunded === undefined
      ) {
        throw new Error("The RPC returned an incomplete StreamCancelled event.");
      }
      return normalizeEvent(log, {
        id: log.args.streamId,
        sender: log.args.sender,
        recipient: log.args.recipient,
        kind: "cancelled",
        amount: log.args.refunded,
      });
    }),
  ];

  events.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
  const recentEvents = events.slice(-HISTORY_LIMIT);
  const blockNumbers = [...new Set(recentEvents.map((event) => event.blockNumber))];
  const blocks = await Promise.all(
    blockNumbers.map((blockNumber) => publicClient.getBlock({ blockNumber })),
  );
  const timestamps = new Map(
    blocks.map((block) => {
      if (block.number === null) throw new Error("The RPC returned an unnumbered event block.");
      return [block.number.toString(), block.timestamp] as const;
    }),
  );

  return {
    streams: streams.sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0)),
    activity: recentEvents.map((event) => {
      const timestamp = timestamps.get(event.blockNumber.toString());
      if (timestamp === undefined) {
        throw new Error("Could not resolve the timestamp for a confirmed stream event.");
      }
      return { ...event, timestamp };
    }),
    blockTimestamp: head.timestamp,
    fetchedAtMs: Date.now(),
    blockNumber: head.number,
  };
}

export async function fetchTokenBalance(walletAddress: Address): Promise<bigint> {
  return publicClient.readContract({
    address: TUSD8_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
}

function deduplicateLogs<T extends { blockHash: Hex | null; logIndex: number | null }>(
  logs: T[],
): T[] {
  const unique = new Map<string, T>();
  for (const log of logs) {
    if (log.blockHash === null || log.logIndex === null) {
      throw new Error("The RPC returned an event without a block hash or log index.");
    }
    unique.set(`${log.blockHash}:${log.logIndex}`, log);
  }
  return [...unique.values()];
}

function normalizeEvent<
  T extends {
    blockNumber: bigint | null;
    logIndex: number | null;
    transactionHash: Hex | null;
  },
>(
  log: T,
  event: {
    id: bigint;
    kind: ActivityRecord["kind"];
    amount: bigint;
    sender: Address;
    recipient: Address;
  },
): Omit<ActivityRecord, "timestamp"> {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
    throw new Error("The RPC returned an event without confirmed transaction metadata.");
  }
  return {
    ...event,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

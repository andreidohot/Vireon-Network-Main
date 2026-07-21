/**
 * @vireon/sdk — public read client for Vireon Mainnet Candidate.
 *
 * Scope: RPC gateway + mining pool public HTTP APIs.
 * Non-goals: smart contracts, key custody, private admin pool endpoints.
 */

export {
  VireonClient,
  VireonError,
  createVireonClient,
  VIREON_FIRST_ACCOUNT_NONCE
} from "./client.js";
export { poolBlockMaturity, type MaturityProgress } from "./maturity.js";
export type {
  AddressAccount,
  AddressBalance,
  Atomic,
  ChainStatus,
  HealthResponse,
  NetworkLimits,
  PoolBlock,
  PoolHistory,
  PoolStatus,
  PoolWorker,
  SignedTransactionBody,
  SubmitTransactionResponse,
  VireonClientOptions
} from "./types.js";

export const VIREON_DEFAULT_RPC_URL = "https://rpcnode.dohotstudio.com";
export const VIREON_DEFAULT_POOL_URL = "https://rpcnode.dohotstudio.com/pool";
export const VIREON_NETWORK_ID = "veiron-mainnet-candidate";

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseEther,
  parseUnits,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

type Quote = {
  buyAmount?: string;
  minBuyAmount?: string;
  buyToken?: string;
  sellAmount?: string;
  sellToken?: string;
  liquidityAvailable?: boolean;
  allowanceTarget?: `0x${string}` | null;
  fees?: any;
  issues?: {
    allowance?: {
      actual: string;
      spender: `0x${string}`;
    } | null;
    balance?: {
      token: `0x${string}`;
      actual: string;
      expected: string;
    } | null;
    [k: string]: any;
  } | any;
  route?: any;
  transaction?: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: string; // decimal string
    gas?: string;
    gasPrice?: string;
  };
  zid?: string;
};

const card = "rounded-2xl border border-ink-700/70 bg-ink-900/60 shadow-card backdrop-blur";

function shortAddr(a?: string | null) {
  if (!a) return "";
  // Example: 0x233…70575
  return `${a.slice(0, 5)}…${a.slice(-5)}`;
}

const erc20Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const NETWORK = {
  id: base.id,
  name: "Base",
  chain: base,
  defaultRpc: "https://mainnet.base.org",
  explorerTx: (hash: string) => `https://basescan.org/tx/${hash}`,
} as const;

const ETH_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const MAX_UINT256 = (1n << 256n) - 1n;


function isPrivateKey(s: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

const VAULT_STORAGE_KEY = "clawnch-operator:vault:v1";
const DEVICE_KEY_STORAGE_KEY = "clawnch-operator:devicekey:v1";
const UNLOCK_CACHE_STORAGE_KEY = "clawnch-operator:unlockcache:v1";
const UNLOCK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type VaultV1 = {
  v: 1;
  saltB64: string;
  ivB64: string;
  ctB64: string;
  createdAt: number;
};

type UnlockCacheV1 = {
  v: 1;
  ivB64: string;
  ctB64: string;
  createdAt: number;
  expiresAt: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getDeviceAesKey(): Promise<CryptoKey> {
  const cryptoObj = globalThis.crypto;
  const subtle = cryptoObj?.subtle;
  if (!cryptoObj || !subtle) throw new Error("WebCrypto not available");

  let b64: string | null = null;
  try {
    b64 = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
  } catch {
    b64 = null;
  }

  if (!b64) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
    b64 = bytesToBase64(bytes);
    localStorage.setItem(DEVICE_KEY_STORAGE_KEY, b64);
  }

  const raw = base64ToBytes(b64);
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function cacheUnlockedFor24h(pk: string) {
  const cryptoObj = globalThis.crypto;
  const subtle = cryptoObj?.subtle;
  if (!cryptoObj || !subtle) throw new Error("WebCrypto not available");

  const key = await getDeviceAesKey();
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));

  const enc = new TextEncoder();
  const pt = enc.encode(pk);
  const ctBuf = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt);

  const payload: UnlockCacheV1 = {
    v: 1,
    ivB64: bytesToBase64(iv),
    ctB64: bytesToBase64(new Uint8Array(ctBuf)),
    createdAt: Date.now(),
    expiresAt: Date.now() + UNLOCK_CACHE_TTL_MS,
  };

  localStorage.setItem(UNLOCK_CACHE_STORAGE_KEY, JSON.stringify(payload));
}

async function loadCachedUnlock(): Promise<string | null> {
  const cryptoObj = globalThis.crypto;
  const subtle = cryptoObj?.subtle;
  if (!cryptoObj || !subtle) return null;

  try {
    const raw = localStorage.getItem(UNLOCK_CACHE_STORAGE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw) as UnlockCacheV1;
    if (!payload || payload.v !== 1 || !payload.ivB64 || !payload.ctB64 || !payload.expiresAt) return null;

    if (Date.now() > payload.expiresAt) {
      localStorage.removeItem(UNLOCK_CACHE_STORAGE_KEY);
      return null;
    }

    const key = await getDeviceAesKey();
    const iv = base64ToBytes(payload.ivB64);
    const ct = base64ToBytes(payload.ctB64);
    const ptBuf = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const dec = new TextDecoder();
    const pk = dec.decode(ptBuf);
    return pk;
  } catch {
    try {
      localStorage.removeItem(UNLOCK_CACHE_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

function clearUnlockCache() {
  try {
    localStorage.removeItem(UNLOCK_CACHE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function deriveAesKey(password: string, salt: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto not available");

  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 310_000,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPrivateKey(pk: string, password: string): Promise<VaultV1> {
  const cryptoObj = globalThis.crypto;
  const subtle = cryptoObj?.subtle;
  if (!cryptoObj || !subtle) throw new Error("WebCrypto not available");

  // IMPORTANT: do not detach getRandomValues from crypto, it can throw "Illegal invocation".
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);

  const enc = new TextEncoder();
  const pt = enc.encode(pk);
  const ctBuf = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt);

  return {
    v: 1,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ctB64: bytesToBase64(new Uint8Array(ctBuf)),
    createdAt: Date.now(),
  };
}

async function decryptPrivateKey(vault: VaultV1, password: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto not available");

  const salt = base64ToBytes(vault.saltB64);
  const iv = base64ToBytes(vault.ivB64);
  const ct = base64ToBytes(vault.ctB64);
  const key = await deriveAesKey(password, salt);

  const ptBuf = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  const dec = new TextDecoder();
  return dec.decode(ptBuf);
}

export default function Page() {
  const [privateKey, setPrivateKey] = useState<string>("");
  const [pkVisible, setPkVisible] = useState(false);

  const [vaultPassword, setVaultPassword] = useState<string>("");
  const [vaultPresent, setVaultPresent] = useState(false);
  const [vaultHydrated, setVaultHydrated] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultErr, setVaultErr] = useState<string>("");

  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null);

  const account = useMemo(() => {
    if (!isPrivateKey(privateKey)) return null;
    try {
      return privateKeyToAccount(privateKey as `0x${string}`);
    } catch {
      return null;
    }
  }, [privateKey]);

  const address = account?.address || null;

  const publicClient = useMemo(
    () => createPublicClient({ chain: NETWORK.chain, transport: http(NETWORK.defaultRpc) }),
    [],
  );

  const walletClient = useMemo(() => {
    if (!account) return null;
    return createWalletClient({ account, chain: NETWORK.chain, transport: http(NETWORK.defaultRpc) });
  }, [account]);

  const [side, setSide] = useState<"buy" | "sell">("buy");

  const [buyToken, setBuyToken] = useState<string>("");
  const [ethAmount, setEthAmount] = useState<string>("0.0001");
  const [tokenAmount, setTokenAmount] = useState<string>("");
  const [tokenAmountTouched, setTokenAmountTouched] = useState(false);
  const [slippagePct, setSlippagePct] = useState<string>("5");

  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenBalanceBase, setTokenBalanceBase] = useState<bigint | null>(null);

  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string>("");

  const sellAmountBaseUnits = useMemo(() => {
    try {
      if (side === "buy") {
        const v = parseEther(ethAmount || "0");
        return v > 0n ? v.toString() : "";
      }

      // sell: token -> ETH (requires decimals)
      if (tokenDecimals === null) return "";
      const v = parseUnits(tokenAmount || "0", tokenDecimals);
      return v > 0n ? v.toString() : "";
    } catch {
      return "";
    }
  }, [ethAmount, tokenAmount, tokenDecimals, side]);

  const canQuote = !!address && !!sellAmountBaseUnits && isAddress(buyToken as any);

  const fetchTokenMeta = async () => {
    setTokenSymbol(null);
    setTokenDecimals(null);
    setTokenBalanceBase(null);

    if (!isAddress(buyToken as any)) return;

    try {
      const reads: any[] = [
        publicClient.readContract({
          address: buyToken as any,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: buyToken as any,
          abi: erc20Abi,
          functionName: "symbol",
        }),
      ];

      if (address) {
        reads.push(
          publicClient.readContract({
            address: buyToken as any,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as any],
          }),
        );
      }

      const [decimals, symbol, bal] = await Promise.all(reads);

      setTokenDecimals(Number(decimals));
      setTokenSymbol(String(symbol));
      if (bal !== undefined) setTokenBalanceBase(BigInt(bal));
    } catch {
      // optional
    }
  };

  const refreshBalance = async () => {
    if (!address) {
      setBalanceWei(null);
      return;
    }
    try {
      const bal = await publicClient.getBalance({ address: address as any });
      setBalanceWei(bal);
    } catch {
      setBalanceWei(null);
    }
  };

  const refreshEthPrice = async () => {
    try {
      const res = await fetch("/api/eth-price");
      const data = await res.json();
      if (res.ok && typeof data?.usd === "number") setEthPriceUsd(data.usd);
    } catch {
      // ignore
    }
  };

  const fetchQuote = async () => {
    setQuoteErr("");
    setTxHash("");
    setQuote(null);

    if (!address) {
      setQuoteErr("Enter a private key first.");
      return;
    }
    if (!sellAmountBaseUnits) {
      setQuoteErr(side === "buy" ? "Enter a valid ETH amount." : "Enter a valid token amount.");
      return;
    }
    if (!isAddress(buyToken as any)) {
      setQuoteErr("Enter a valid token contract address.");
      return;
    }

    const reqBuyToken = side === "buy" ? buyToken : ETH_PLACEHOLDER;
    const reqSellToken = side === "buy" ? ETH_PLACEHOLDER : buyToken;

    setBusy(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: NETWORK.id,
          buyToken: reqBuyToken,
          sellToken: reqSellToken,
          sellAmount: sellAmountBaseUnits,
          taker: address,
          slippageBps: Math.round(Math.max(0, Math.min(100, Number(slippagePct || "1"))) * 100),
        }),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        // keep text
      }

      if (!res.ok) {
        const msg = typeof data === "object" ? (data?.reason || data?.message || data?.error || JSON.stringify(data)) : text;
        throw new Error(msg || `HTTP ${res.status}`);
      }

      setQuote(data as Quote);
    } catch (e: any) {
      setQuoteErr(e?.message || "Failed to fetch quote");
    } finally {
      setBusy(false);
    }
  };

  const vaultSave = async () => {
    setVaultErr("");

    if (!isPrivateKey(privateKey)) {
      setVaultErr("Private key is not valid yet.");
      return;
    }

    if ((vaultPassword || "").length < 6) {
      setVaultErr("Password must be at least 6 characters.");
      return;
    }

    setVaultBusy(true);
    try {
      const payload = await encryptPrivateKey(privateKey, vaultPassword);
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(payload));
      setVaultPresent(true);

      // Cache unlocked state for convenience (24h)
      await cacheUnlockedFor24h(privateKey);

      setVaultPassword("");
    } catch (e: any) {
      setVaultErr(e?.message || "Failed to save vault.");
    } finally {
      setVaultBusy(false);
    }
  };

  const vaultUnlock = async () => {
    setVaultErr("");

    if (!vaultPresent) {
      setVaultErr("No stored private key found.");
      return;
    }

    if (!vaultPassword) {
      setVaultErr("Enter a password to unlock the vault.");
      return;
    }

    setVaultBusy(true);
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) {
        setVaultPresent(false);
        setVaultErr("Vault not found.");
        return;
      }

      const parsed = JSON.parse(raw) as VaultV1;
      if (!parsed || parsed.v !== 1 || !parsed.saltB64 || !parsed.ivB64 || !parsed.ctB64) {
        throw new Error("Invalid vault format");
      }

      const pk = await decryptPrivateKey(parsed, vaultPassword);
      if (!isPrivateKey(pk)) throw new Error("Wrong password or corrupted data");

      setPrivateKey(pk);
      await cacheUnlockedFor24h(pk);
      setVaultPassword("");
    } catch (e: any) {
      setVaultErr(e?.message || "Failed to unlock vault.");
    } finally {
      setVaultBusy(false);
    }
  };

  const vaultForget = () => {
    setVaultErr("");
    try {
      localStorage.removeItem(VAULT_STORAGE_KEY);
      localStorage.removeItem(UNLOCK_CACHE_STORAGE_KEY);
      localStorage.removeItem(DEVICE_KEY_STORAGE_KEY);
    } catch {
      // ignore
    }
    setPrivateKey("");
    setQuote(null);
    setQuoteErr("");
    setTxHash("");
    setVaultPresent(false);
  };

  const vaultLock = () => {
    clearUnlockCache();
    setPrivateKey("");
    setQuote(null);
    setQuoteErr("");
    setTxHash("");
  };

  const onBuy = async () => {
    setQuoteErr("");
    setTxHash("");

    if (!walletClient || !account) {
      setQuoteErr("Private key is invalid.");
      return;
    }

    if (!sellAmountBaseUnits) {
      setQuoteErr(side === "buy" ? "Enter a valid ETH amount." : "Enter a valid token amount.");
      return;
    }

    if (!isAddress(buyToken as any)) {
      setQuoteErr("Enter a valid token contract address.");
      return;
    }

    const reqBuyToken = side === "buy" ? buyToken : ETH_PLACEHOLDER;
    const reqSellToken = side === "buy" ? ETH_PLACEHOLDER : buyToken;

    setBusy(true);
    try {
      const fetchFirmQuote = async () => {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: NETWORK.id,
            buyToken: reqBuyToken,
            sellToken: reqSellToken,
            sellAmount: sellAmountBaseUnits,
            taker: account.address,
            slippageBps: Math.round(Math.max(0, Math.min(100, Number(slippagePct || "1"))) * 100),
          }),
        });

        const data = (await res.json()) as Quote;
        if (!res.ok) throw new Error((data as any)?.reason || (data as any)?.message || "Quote failed");
        return data;
      };

      let data = await fetchFirmQuote();

      // If selling ERC-20, we may need a one-time approval.
      if (side === "sell" && data?.issues?.allowance) {
        const spender = data.issues?.allowance?.spender || data.allowanceTarget;
        if (spender && isAddress(spender as any)) {
          const approveHash = await walletClient.writeContract({
            address: buyToken as any,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender as any, MAX_UINT256],
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash as any });
          data = await fetchFirmQuote();
        }
      }

      if (!data?.transaction?.to || !data?.transaction?.data) throw new Error("Quote missing transaction payload");

      const valueDec = data.transaction.value ?? (side === "buy" ? sellAmountBaseUnits : "0");
      const value = BigInt(valueDec);

      const hash = await walletClient.sendTransaction({
        to: data.transaction.to,
        data: data.transaction.data,
        value,
      });

      setQuote(data);
      setTxHash(hash);
      void refreshBalance();
      void fetchTokenMeta();
    } catch (e: any) {
      setQuoteErr(e?.message || "Transaksi gagal");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    try {
      setVaultPresent(!!localStorage.getItem(VAULT_STORAGE_KEY));
    } catch {
      setVaultPresent(false);
    }

    // Auto-unlock from device cache (valid for 24h)
    (async () => {
      try {
        const pk = await loadCachedUnlock();
        if (pk && isPrivateKey(pk)) setPrivateKey(pk);
      } catch {
        // ignore
      } finally {
        setVaultHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    void fetchTokenMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyToken, address]);

  useEffect(() => {
    // reset typed token amount when switching side or changing token
    setTokenAmountTouched(false);
    if (side === "buy") setTokenAmount("");
    if (side === "sell") setTokenAmount("");
  }, [side, buyToken]);

  useEffect(() => {
    // Auto-fill MAX token amount when user wants to SELL and token balance is known.
    if (side !== "sell") return;
    if (tokenAmountTouched) return;
    if (tokenDecimals === null) return;
    if (tokenBalanceBase === null) return;
    if (tokenBalanceBase <= 0n) return;

    try {
      setTokenAmount(formatUnits(tokenBalanceBase, tokenDecimals));
    } catch {
      // ignore
    }
  }, [side, tokenAmountTouched, tokenDecimals, tokenBalanceBase]);

  useEffect(() => {
    void refreshBalance();
    const t = setInterval(() => void refreshBalance(), 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    void refreshEthPrice();
    const t = setInterval(() => void refreshEthPrice(), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setQuote(null);
    setQuoteErr("");
    setTxHash("");
  }, [buyToken, ethAmount, tokenAmount, slippagePct, privateKey, side]);

  const estimatedOut = useMemo(() => {
    if (!quote?.buyAmount) return null;
    try {
      if (side === "sell") return formatEther(BigInt(quote.buyAmount));
      if (tokenDecimals === null) return quote.buyAmount;
      return formatUnits(BigInt(quote.buyAmount), tokenDecimals);
    } catch {
      return quote.buyAmount;
    }
  }, [quote?.buyAmount, tokenDecimals, side]);

  const minOut = useMemo(() => {
    if (!quote?.minBuyAmount) return null;
    try {
      if (side === "sell") return formatEther(BigInt(quote.minBuyAmount));
      if (tokenDecimals === null) return quote.minBuyAmount;
      return formatUnits(BigInt(quote.minBuyAmount), tokenDecimals);
    } catch {
      return quote.minBuyAmount;
    }
  }, [quote?.minBuyAmount, tokenDecimals, side]);

  const balanceEth = balanceWei !== null ? formatEther(balanceWei) : null;

  const balanceUsd = useMemo(() => {
    if (!balanceEth || !ethPriceUsd) return null;
    const v = Number(balanceEth) * ethPriceUsd;
    return Number.isFinite(v) ? v : null;
  }, [balanceEth, ethPriceUsd]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 items-center gap-3">
            <div className="text-xs tracking-[0.22em] text-white/60">CLAWNCH OPERATOR</div>

            <div className="justify-self-center">
              {address ? (
                <div className="rounded-xl border border-ink-700/70 bg-ink-900/60 px-3 py-2 text-xs text-white/75 whitespace-nowrap">
                  {shortAddr(address)} {balanceEth ? `${Number(balanceEth).toFixed(3)} ETH` : "… ETH"} {balanceUsd !== null ? `(~$${balanceUsd.toFixed(2)})` : "(~$…)"}
                </div>
              ) : null}
            </div>

            <div className="justify-self-end" />
          </div>

          {/* security notice removed */}
        </div>

        <div className="mt-7 grid grid-cols-1 gap-4">
          <section className={`${card} p-5`}>
            <div className="flex flex-col gap-4">
              {!vaultHydrated ? (
                <div className="h-12" />
              ) : vaultPresent ? (
                <div className="flex flex-col gap-2">
                  {!privateKey ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        value={vaultPassword}
                        onChange={(e) => setVaultPassword(e.target.value)}
                        placeholder="Password"
                        type="password"
                        className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                        autoComplete="off"
                      />

                      <button
                        type="button"
                        onClick={() => void vaultUnlock()}
                        disabled={!vaultPassword || vaultBusy}
                        className="h-11 rounded-xl bg-coral-500 px-4 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-55"
                      >
                        {vaultBusy ? "Working…" : "Unlock"}
                      </button>

                      <button
                        type="button"
                        onClick={() => vaultForget()}
                        disabled={vaultBusy}
                        className="h-11 rounded-xl border border-ink-700/70 bg-white/5 px-4 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50"
                      >
                        Forget
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => vaultLock()}
                        className="h-11 rounded-xl border border-ink-700/70 bg-white/5 px-4 text-sm font-semibold text-white/90 hover:bg-white/10"
                      >
                        Lock
                      </button>

                      <button
                        type="button"
                        onClick={() => vaultForget()}
                        className="h-11 rounded-xl border border-ink-700/70 bg-white/5 px-4 text-sm font-semibold text-white/90 hover:bg-white/10"
                      >
                        Forget
                      </button>
                    </div>
                  )}

                  {vaultErr ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {vaultErr}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/60">Private key (Base wallet)</span>
                    <button
                      onClick={() => setPkVisible((v) => !v)}
                      className="text-xs font-semibold text-white/60 hover:text-white"
                      type="button"
                    >
                      {pkVisible ? "Hide" : "Show"}
                    </button>
                  </div>

                  <input
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value.trim())}
                    placeholder="0x…"
                    type={pkVisible ? "text" : "password"}
                    className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                    autoComplete="off"
                    spellCheck={false}
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      value={vaultPassword}
                      onChange={(e) => setVaultPassword(e.target.value)}
                      placeholder="Password"
                      type="password"
                      className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                      autoComplete="off"
                    />

                    <button
                      type="button"
                      onClick={() => void vaultSave()}
                      disabled={!isPrivateKey(privateKey) || !vaultPassword || vaultBusy}
                      className="h-11 rounded-xl bg-coral-500 px-4 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-55"
                    >
                      {vaultBusy ? "Working…" : "Save (encrypted)"}
                    </button>

                    <button
                      type="button"
                      onClick={() => vaultLock()}
                      disabled={!privateKey || vaultBusy}
                      className="h-11 rounded-xl border border-ink-700/70 bg-white/5 px-4 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>

                  {vaultErr ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {vaultErr}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSide("buy")}
                  className={`h-9 rounded-xl border px-3 text-xs font-semibold ${
                    side === "buy"
                      ? "border-coral-500/50 bg-coral-500/15 text-white"
                      : "border-ink-700/70 bg-white/5 text-white/75 hover:bg-white/10"
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setSide("sell")}
                  className={`h-9 rounded-xl border px-3 text-xs font-semibold ${
                    side === "sell"
                      ? "border-coral-500/50 bg-coral-500/15 text-white"
                      : "border-ink-700/70 bg-white/5 text-white/75 hover:bg-white/10"
                  }`}
                >
                  Sell
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {side === "buy" ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-white/60">ETH amount</span>
                    <input
                      value={ethAmount}
                      onChange={(e) => setEthAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.0001"
                      className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-white/60">Token amount</span>
                    <input
                      value={tokenAmount}
                      onChange={(e) => {
                        setTokenAmountTouched(true);
                        setTokenAmount(e.target.value);
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                    />
                  </label>
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-white/60">Slippage (%)</span>
                  <input
                    value={slippagePct}
                    onChange={(e) => setSlippagePct(e.target.value)}
                    inputMode="decimal"
                    placeholder="5"
                    className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-white/60">Token contract address</span>
                <input
                  value={buyToken}
                  onChange={(e) => setBuyToken(e.target.value.trim())}
                  placeholder="0x…"
                  className="h-11 rounded-xl border border-ink-700/70 bg-ink-950/30 px-3 text-sm text-white outline-none focus:border-coral-500/70"
                />
                {tokenBalanceBase !== null && tokenDecimals !== null ? (
                  <div className="text-xs text-white/45">
                    Bal: {formatUnits(tokenBalanceBase, tokenDecimals)}{tokenSymbol ? ` ${tokenSymbol}` : ""}
                  </div>
                ) : null}
              </label>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  onClick={() => void fetchQuote()}
                  disabled={!canQuote || busy}
                  className="h-11 rounded-xl border border-ink-700/70 bg-white/5 px-4 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50"
                >
                  {busy ? "Loading…" : "Get quote"}
                </button>

                <button
                  onClick={() => void onBuy()}
                  disabled={!canQuote || busy}
                  className="h-11 rounded-xl bg-coral-500 px-4 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-55"
                >
                  {busy ? "Working…" : side === "buy" ? "Buy" : "Sell"}
                </button>

                {/* balance moved to header */}
              </div>

              {quoteErr ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {quoteErr}
                </div>
              ) : null}

              {quote ? (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-ink-700/70 bg-ink-950/25 p-4">
                    <div className="text-xs text-white/60">Estimated output</div>
                    <div className="mt-1 text-lg font-semibold">
                      {estimatedOut || "—"}
                      {side === "buy" ? (tokenSymbol ? ` ${tokenSymbol}` : "") : " ETH"}
                    </div>
                    {minOut ? (
                      <div className="mt-1 text-xs text-white/50">
                        Min out: {minOut}{side === "buy" ? (tokenSymbol ? ` ${tokenSymbol}` : "") : " ETH"}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-ink-700/70 bg-ink-950/25 p-4">
                    <div className="text-xs text-white/60">Transaction</div>
                    <div className="mt-1 text-sm text-white/80">to: {quote.transaction?.to ? shortAddr(quote.transaction.to) : "—"}</div>
                    <div className="mt-1 text-xs text-white/50">Sent directly from the imported key (Base).</div>
                  </div>
                </div>
              ) : null}

              {txHash ? (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  Submitted: {shortAddr(txHash)} ·{" "}
                  <a className="underline" href={NETWORK.explorerTx(txHash)} target="_blank" rel="noreferrer">
                    View on Basescan
                  </a>
                </div>
              ) : null}

              {/* note removed */}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

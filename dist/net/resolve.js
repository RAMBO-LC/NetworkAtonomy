/**
 * DNS resolution with SSRF guard.
 *
 * Resolves A/AAAA records for a hostname, checks all IPs against the
 * address guard, and returns the first allowed IP with its family.
 * If ANY resolved IP is blocked, throws an error.
 */
import { isIP } from "node:net";
import { classifyAddress, isAddressBlocked } from "./address";
/**
 * Default DNS resolver using Node.js `dns/promises`.
 * Resolves both A and AAAA records in parallel.
 */
export async function defaultDnsResolver(hostname) {
    const { resolve4, resolve6 } = await import("node:dns/promises");
    const [ipv4, ipv6] = await Promise.all([
        resolve4(hostname).catch(() => []),
        resolve6(hostname).catch(() => []),
    ]);
    return { ipv4, ipv6 };
}
/**
 * Error thrown when DNS resolution yields no addresses.
 */
export class ResolutionError extends Error {
    constructor(hostname) {
        super(`DNS resolution failed for ${hostname}: no addresses found`);
        this.name = "ResolutionError";
    }
}
/**
 * Error thrown when any resolved address is blocked by the SSRF guard.
 */
export class BlockedAddressError extends Error {
    blockedAddresses;
    constructor(hostname, blockedAddresses) {
        const addresses = blockedAddresses.join(", ");
        super(`SSRF guard blocked ${hostname}: ${addresses}`);
        this.name = "BlockedAddressError";
        this.blockedAddresses = blockedAddresses;
    }
}
/**
 * Check if an address is an IPv4-mapped IPv6 address (::ffff:x.x.x.x).
 */
function isIpv4MappedIpv6(address) {
    return address.startsWith("::ffff:") && address.includes(".");
}
/**
 * Extract the IPv4 address from an IPv4-mapped IPv6 address.
 */
function extractIpv4FromMapped(address) {
    const match = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return match?.[1] ?? null;
}
/**
 * Check if an address is blocked, handling IPv4-mapped IPv6 addresses
 * that the underlying address module may not handle correctly.
 */
function checkAddressBlocked(address) {
    // First, explicitly check for IPv4-mapped IPv6 addresses
    // The address module parses them but doesn't check the mapped IPv4 against blocked ranges
    if (isIpv4MappedIpv6(address)) {
        const ipv4 = extractIpv4FromMapped(address);
        if (ipv4) {
            try {
                if (isAddressBlocked(ipv4)) {
                    const classified = classifyAddress(ipv4);
                    return { blocked: true, blockedRange: classified.blockedRange };
                }
                return { blocked: false };
            }
            catch {
                // If even IPv4 check fails, treat as blocked for safety
                return { blocked: true, blockedRange: "invalid-mapped" };
            }
        }
    }
    // Standard check for all other addresses
    try {
        if (isAddressBlocked(address)) {
            // Get the blocked range name by calling classifyAddress
            const classified = classifyAddress(address);
            return { blocked: true, blockedRange: classified.blockedRange };
        }
        return { blocked: false };
    }
    catch {
        // For any other unparseable address, treat as blocked for safety
        return { blocked: true, blockedRange: "unparseable" };
    }
}
/**
 * Get the normalized address and family, handling IPv4-mapped IPv6.
 */
function getNormalizedAddressAndFamily(address) {
    try {
        const classified = classifyAddress(address);
        return { address: classified.address, family: classified.family };
    }
    catch {
        // Handle IPv4-mapped IPv6
        if (isIpv4MappedIpv6(address)) {
            const ipv4 = extractIpv4FromMapped(address);
            if (ipv4) {
                const classified = classifyAddress(ipv4);
                return { address: classified.address, family: "ipv4" };
            }
        }
        throw new Error(`Invalid IP address: ${address}`);
    }
}
/**
 * Resolve a hostname to an allowed IP address.
 *
 * @param hostname - The hostname to resolve.
 * @param resolver - Optional DNS resolver. Defaults to Node.js `dns/promises`.
 *                   Injected for testing (e.g., fake resolver returning blocked IPs).
 * @param allowPrivate - If true, bypass SSRF guard and allow private/loopback addresses. Default: false.
 * @returns The first allowed IP address and its family (prefers IPv4).
 * @throws {ResolutionError} If no addresses are resolved.
 * @throws {BlockedAddressError} If ANY resolved address is in a blocked range (unless allowPrivate is true).
 */
export async function resolveHostname(hostname, resolver = defaultDnsResolver, allowPrivate = false) {
    // If hostname is already an IP, bypass DNS resolution
    const ipFamily = isIP(hostname);
    if (ipFamily !== 0) {
        const address = hostname;
        const family = ipFamily === 4 ? "ipv4" : "ipv6";
        if (!allowPrivate && isAddressBlocked(address)) {
            throw new BlockedAddressError(hostname, [address]);
        }
        return { address, family: family };
    }
    const { ipv4, ipv6 } = await resolver(hostname);
    const allAddresses = [...ipv4, ...ipv6];
    if (allAddresses.length === 0) {
        throw new ResolutionError(hostname);
    }
    // Check ALL addresses against the guard first.
    // If ANY is blocked, abort immediately (SSRF protection).
    // Skip this check if allowPrivate is true (for local testing).
    if (!allowPrivate) {
        const blockedAddresses = [];
        for (const address of allAddresses) {
            const { blocked } = checkAddressBlocked(address);
            if (blocked) {
                blockedAddresses.push(address);
            }
        }
        if (blockedAddresses.length > 0) {
            throw new BlockedAddressError(hostname, blockedAddresses);
        }
    }
    // All addresses are allowed. Pick the first one, preferring IPv4.
    const preferredOrder = [...ipv4, ...ipv6];
    const chosen = preferredOrder[0];
    if (!chosen) {
        throw new ResolutionError(hostname);
    }
    const { address, family } = getNormalizedAddressAndFamily(chosen);
    return { address, family };
}

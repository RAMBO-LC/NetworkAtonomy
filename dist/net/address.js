/**
 * Pure IPv4/IPv6 address classification: blocked vs allowed.
 *
 * Blocked ranges per docs/parameters.md "Safety Settings":
 *
 * IPv4:
 * - 10.0.0.0/8         (private)
 * - 172.16.0.0/12      (private)
 * - 192.168.0.0/16     (private)
 * - 127.0.0.0/8        (loopback)
 * - 169.254.0.0/16     (link-local)
 * - 0.0.0.0/8          (unspecified)
 * - 224.0.0.0/4        (multicast)
 * - 240.0.0.0/4        (reserved)
 *
 * IPv6:
 * - ::1/128            (loopback)
 * - fe80::/10          (link-local)
 * - fc00::/7           (unique-local)
 * - ::/128             (unspecified)
 * - ff00::/8           (multicast)
 *
 * Every function in this module is pure: deterministic for a given input,
 * no I/O, no global state read or written.
 */
/**
 * IPv4 blocked ranges in CIDR notation with descriptive names.
 * Order matters: more specific ranges should come before less specific ones
 * if there's any overlap, though these ranges are disjoint.
 */
const IPV4_BLOCKED_RANGES = [
    { cidr: "10.0.0.0/8", name: "private-10", prefixLength: 8, networkAddress: ipv4ToNumber("10.0.0.0") },
    { cidr: "172.16.0.0/12", name: "private-172", prefixLength: 12, networkAddress: ipv4ToNumber("172.16.0.0") },
    { cidr: "192.168.0.0/16", name: "private-192", prefixLength: 16, networkAddress: ipv4ToNumber("192.168.0.0") },
    { cidr: "127.0.0.0/8", name: "loopback", prefixLength: 8, networkAddress: ipv4ToNumber("127.0.0.0") },
    { cidr: "169.254.0.0/16", name: "link-local", prefixLength: 16, networkAddress: ipv4ToNumber("169.254.0.0") },
    { cidr: "0.0.0.0/8", name: "unspecified", prefixLength: 8, networkAddress: ipv4ToNumber("0.0.0.0") },
    { cidr: "224.0.0.0/4", name: "multicast", prefixLength: 4, networkAddress: ipv4ToNumber("224.0.0.0") },
    { cidr: "240.0.0.0/4", name: "reserved", prefixLength: 4, networkAddress: ipv4ToNumber("240.0.0.0") },
];
/**
 * IPv6 blocked ranges in CIDR notation with descriptive names.
 */
const IPV6_BLOCKED_RANGES = [
    { cidr: "::1/128", name: "loopback", prefixLength: 128, networkAddress: ipv6ToBigInt("::1") },
    { cidr: "fe80::/10", name: "link-local", prefixLength: 10, networkAddress: ipv6ToBigInt("fe80::") },
    { cidr: "fc00::/7", name: "unique-local", prefixLength: 7, networkAddress: ipv6ToBigInt("fc00::") },
    { cidr: "::/128", name: "unspecified", prefixLength: 128, networkAddress: ipv6ToBigInt("::") },
    { cidr: "ff00::/8", name: "multicast", prefixLength: 8, networkAddress: ipv6ToBigInt("ff00::") },
];
/**
 * Convert an IPv4 address string to a 32-bit unsigned integer.
 * Throws if the address is invalid.
 */
function ipv4ToNumber(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4) {
        throw new Error(`Invalid IPv4 address: ${ip}`);
    }
    let result = 0;
    for (let i = 0; i < 4; i++) {
        const part = parts[i] ?? "";
        const octet = parseInt(part, 10);
        if (isNaN(octet) || octet < 0 || octet > 255 || part.length !== String(octet).length) {
            throw new Error(`Invalid IPv4 address: ${ip}`);
        }
        result = (result << 8) | octet;
    }
    return result >>> 0;
}
/**
 * Convert a 32-bit unsigned integer to an IPv4 address string.
 */
function numberToIpv4(num) {
    return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
    ].join(".");
}
/**
 * Convert an IPv6 address string to a 128-bit bigint.
 * Supports compressed notation (::).
 * Throws if the address is invalid.
 */
function ipv6ToBigInt(ip) {
    // Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
    if (ip.includes(".")) {
        const parts = ip.split(":");
        const lastPart = parts[parts.length - 1] ?? "";
        if (lastPart.includes(".")) {
            const ipv4Part = lastPart;
            const ipv4Num = ipv4ToNumber(ipv4Part);
            const prefixParts = parts.slice(0, -1).join(":");
            const prefixBigInt = ipv6ToBigInt(prefixParts + "::");
            return (prefixBigInt & 0xffffffffffffffffffffffffffff0000n) | BigInt(ipv4Num);
        }
    }
    const parts = ip.split("::");
    if (parts.length > 2) {
        throw new Error(`Invalid IPv6 address: ${ip}`);
    }
    const leftParts = parts[0] ? parts[0].split(":").filter(Boolean) : [];
    const rightParts = parts[1] ? parts[1].split(":").filter(Boolean) : [];
    const totalParts = leftParts.length + rightParts.length;
    if (totalParts > 8) {
        throw new Error(`Invalid IPv6 address: ${ip}`);
    }
    const missingParts = 8 - totalParts;
    const allParts = [
        ...leftParts,
        ...new Array(missingParts).fill("0"),
        ...rightParts,
    ];
    let result = 0n;
    for (const part of allParts) {
        const value = parseInt(part, 16);
        if (isNaN(value) || value < 0 || value > 0xffff || part.length > 4) {
            throw new Error(`Invalid IPv6 address: ${ip}`);
        }
        result = (result << 16n) | BigInt(value);
    }
    return result;
}
/**
 * Convert a 128-bit bigint to an IPv6 address string (compressed form).
 */
function bigIntToIpv6(num) {
    const parts = [];
    for (let i = 0; i < 8; i++) {
        const shift = (7 - i) * 16;
        const part = (num >> BigInt(shift)) & 0xffffn;
        parts.push(part.toString(16));
    }
    // Compress the longest run of zeros
    let bestStart = -1;
    let bestLength = 0;
    let currentStart = -1;
    let currentLength = 0;
    for (let i = 0; i <= 8; i++) {
        if (i < 8 && parts[i] === "0") {
            if (currentStart === -1)
                currentStart = i;
            currentLength++;
        }
        else {
            if (currentLength > bestLength) {
                bestStart = currentStart;
                bestLength = currentLength;
            }
            currentStart = -1;
            currentLength = 0;
        }
    }
    if (bestLength > 1) {
        const before = parts.slice(0, bestStart).join(":");
        const after = parts.slice(bestStart + bestLength).join(":");
        if (before && after)
            return `${before}::${after}`;
        if (before)
            return `${before}::`;
        if (after)
            return `::${after}`;
        return "::";
    }
    return parts.join(":");
}
/**
 * Check if an IPv4 address (as number) is within a CIDR range.
 */
function ipv4InCidr(address, networkAddress, prefixLength) {
    if (prefixLength === 0)
        return true;
    const mask = ~((1 << (32 - prefixLength)) - 1);
    return (address & mask) === (networkAddress & mask);
}
/**
 * Check if an IPv6 address (as bigint) is within a CIDR range.
 */
function ipv6InCidr(address, networkAddress, prefixLength) {
    if (prefixLength === 0)
        return true;
    if (prefixLength === 128)
        return address === networkAddress;
    const mask = ~((1n << BigInt(128 - prefixLength)) - 1n);
    return (address & mask) === (networkAddress & mask);
}
/**
 * Parse and normalize an IPv4 address string.
 * Returns the normalized address string or throws if invalid.
 */
export function parseIpv4(address) {
    const num = ipv4ToNumber(address.trim());
    return numberToIpv4(num);
}
/**
 * Parse and normalize an IPv6 address string.
 * Returns the normalized address string (compressed form) or throws if invalid.
 */
export function parseIpv6(address) {
    const bigInt = ipv6ToBigInt(address.trim());
    return bigIntToIpv6(bigInt);
}
/**
 * Detect the address family of an address string.
 * Returns "ipv4", "ipv6", or throws if neither.
 */
export function detectAddressFamily(address) {
    const trimmed = address.trim();
    if (trimmed.includes(":")) {
        // Could be IPv6 or IPv4-mapped IPv6
        try {
            ipv6ToBigInt(trimmed);
            return "ipv6";
        }
        catch {
            throw new Error(`Invalid IP address: ${address}`);
        }
    }
    else if (trimmed.includes(".")) {
        try {
            ipv4ToNumber(trimmed);
            return "ipv4";
        }
        catch {
            throw new Error(`Invalid IP address: ${address}`);
        }
    }
    throw new Error(`Invalid IP address: ${address}`);
}
/**
 * Check if an IPv4 address is in any blocked range.
 * Returns the name of the blocked range if blocked, undefined if allowed.
 */
function checkIpv4Blocked(address) {
    const num = ipv4ToNumber(address);
    for (const range of IPV4_BLOCKED_RANGES) {
        if (ipv4InCidr(num, range.networkAddress, range.prefixLength)) {
            return range.name;
        }
    }
    return undefined;
}
/**
 * Check if an IPv6 address is in any blocked range.
 * Returns the name of the blocked range if blocked, undefined if allowed.
 */
function checkIpv6Blocked(address) {
    const bigInt = ipv6ToBigInt(address);
    for (const range of IPV6_BLOCKED_RANGES) {
        if (ipv6InCidr(bigInt, range.networkAddress, range.prefixLength)) {
            return range.name;
        }
    }
    return undefined;
}
/**
 * Classify an IP address as allowed or blocked.
 * The address can be IPv4 or IPv6 in any valid notation.
 * Throws if the address is not a valid IP address.
 */
export function classifyAddress(address) {
    const trimmed = address.trim();
    const family = detectAddressFamily(trimmed);
    let normalized;
    let blockedRange;
    if (family === "ipv4") {
        normalized = parseIpv4(trimmed);
        blockedRange = checkIpv4Blocked(normalized);
    }
    else {
        normalized = parseIpv6(trimmed);
        blockedRange = checkIpv6Blocked(normalized);
    }
    return {
        address: normalized,
        family,
        classification: blockedRange ? "blocked" : "allowed",
        blockedRange,
    };
}
/**
 * Convenience function: true if the address is allowed (not blocked).
 */
export function isAddressAllowed(address) {
    return classifyAddress(address).classification === "allowed";
}
/**
 * Convenience function: true if the address is blocked.
 */
export function isAddressBlocked(address) {
    return classifyAddress(address).classification === "blocked";
}
/**
 * Get all blocked IPv4 CIDR ranges as strings.
 * Useful for documentation or debugging.
 */
export function getBlockedIpv4Ranges() {
    return IPV4_BLOCKED_RANGES.map((r) => r.cidr);
}
/**
 * Get all blocked IPv6 CIDR ranges as strings.
 * Useful for documentation or debugging.
 */
export function getBlockedIpv6Ranges() {
    return IPV6_BLOCKED_RANGES.map((r) => r.cidr);
}

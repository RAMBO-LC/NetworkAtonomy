import { describe, it, expect } from 'vitest';
import { isAddressBlocked, classifyAddress } from '../address';

describe('address safety classification', () => {
  describe('IPv4 blocked ranges', () => {
    const blockedIpv4 = [
      { name: 'private-10', address: '10.0.0.1' },
      { name: 'private-172', address: '172.16.0.1' },
      { name: 'private-192', address: '192.168.0.1' },
      { name: 'loopback', address: '127.0.0.1' },
      { name: 'link-local', address: '169.254.0.1' },
      { name: 'unspecified', address: '0.0.0.1' },
      { name: 'multicast', address: '224.0.0.1' },
      { name: 'reserved', address: '240.0.0.1' },
    ];

    blockedIpv4.forEach(({ name, address }) => {
      it(`should block ${name} range: ${address}`, () => {
        const result = classifyAddress(address);
        expect(result.classification).toBe('blocked');
        expect(result.blockedRange).toBe(name);
        expect(isAddressBlocked(address)).toBe(true);
      });
    });
  });

  describe('IPv6 blocked ranges', () => {
    const blockedIpv6 = [
      { name: 'loopback', address: '::1' },
      { name: 'link-local', address: 'fe80::1' },
      { name: 'unique-local', address: 'fc00::1' },
      { name: 'unspecified', address: '::' },
      { name: 'multicast', address: 'ff00::1' },
    ];

    blockedIpv6.forEach(({ name, address }) => {
      it(`should block ${name} range: ${address}`, () => {
        const result = classifyAddress(address);
        expect(result.classification).toBe('blocked');
        expect(result.blockedRange).toBe(name);
        expect(isAddressBlocked(address)).toBe(true);
      });
    });
  });

  describe('Allowed addresses', () => {
    const allowedIpv4 = ['8.8.8.8', '1.1.1.1', '9.9.9.9', '203.0.113.1', '198.51.100.1'];
    const allowedIpv6 = ['2001:4860:4860::8888', '2606:4700:4700::1111', '2001:db8::1'];

    allowedIpv4.forEach((address) => {
      it(`should allow IPv4: ${address}`, () => {
        const result = classifyAddress(address);
        expect(result.classification).toBe('allowed');
        expect(result.blockedRange).toBeUndefined();
        expect(isAddressBlocked(address)).toBe(false);
      });
    });

    allowedIpv6.forEach((address) => {
      it(`should allow IPv6: ${address}`, () => {
        const result = classifyAddress(address);
        expect(result.classification).toBe('allowed');
        expect(result.blockedRange).toBeUndefined();
        expect(isAddressBlocked(address)).toBe(false);
      });
    });
  });
});

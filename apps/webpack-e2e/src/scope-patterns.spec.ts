import { describe, it, expect } from 'vitest';
import { buildScopePatterns } from '@davnx/webpack';

describe('buildScopePatterns', () => {
  it('should handle empty input', () => {
    const result = buildScopePatterns([]);
    expect(result.allowlistPatterns).toEqual([]);
    expect(result.scopePrefixes).toEqual([]);
    expect(result.scopePatterns).toEqual([]);
  });

  it('should handle org scope (@myorg)', () => {
    const result = buildScopePatterns(['@myorg']);
    expect(result.scopePrefixes).toContain('@myorg/');
    expect(result.allowlistPatterns.length).toBeGreaterThan(0);
    // Should match @myorg/anything
    expect(result.allowlistPatterns.some((p) => p.test('@myorg/some-package'))).toBe(true);
  });

  it('should handle prefix (@myorg/prefix)', () => {
    const result = buildScopePatterns(['@myorg/shared']);
    expect(result.scopePrefixes).toContain('@myorg/shared');
    // Should match @myorg/shared-utils
    expect(result.allowlistPatterns.some((p) => p.test('@myorg/shared-utils'))).toBe(true);
    // Should NOT match @myorg/other-pkg
    expect(result.allowlistPatterns.some((p) => p.test('@myorg/other-pkg'))).toBe(false);
  });

  it('should handle regex pattern (/pattern/)', () => {
    const result = buildScopePatterns(['/^@test\\//']);
    expect(result.scopePatterns.length).toBeGreaterThan(0);
    expect(result.allowlistPatterns.some((p) => p.test('@test/foo'))).toBe(true);
  });

  it('should handle exact package name', () => {
    const result = buildScopePatterns(['lodash']);
    expect(result.allowlistPatterns.some((p) => p.test('lodash'))).toBe(true);
    expect(result.allowlistPatterns.some((p) => p.test('lodash/fp'))).toBe(true);
    // Should not match lodash-es (different package)
    expect(result.allowlistPatterns.some((p) => p.test('lodash-es'))).toBe(false);
  });

  it('should handle mixed patterns', () => {
    const result = buildScopePatterns([
      '@myorg',
      'lodash',
      '/^special-/',
    ]);
    expect(result.allowlistPatterns.length).toBeGreaterThan(0);
    expect(result.allowlistPatterns.some((p) => p.test('@myorg/anything'))).toBe(true);
    expect(result.allowlistPatterns.some((p) => p.test('lodash'))).toBe(true);
    expect(result.allowlistPatterns.some((p) => p.test('special-pkg'))).toBe(true);
  });
});

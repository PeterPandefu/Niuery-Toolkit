import { describe, it, expect } from 'vitest';
import { findMockRule, generateMockResponse } from '@/lib/mock-engine';
import { createMockRule } from '@/store/api-tester-store';

describe('mock-engine', () => {
  describe('findMockRule', () => {
    const rules = [
      createMockRule({ id: '1', enabled: true, method: 'GET', urlPattern: '/api/users' }),
      createMockRule({ id: '2', enabled: true, method: 'POST', urlPattern: '/api/users' }),
      createMockRule({ id: '3', enabled: true, method: '*', urlPattern: '/api/users/*' }),
      createMockRule({ id: '4', enabled: false, method: 'GET', urlPattern: '/api/disabled' }),
      createMockRule({ id: '5', enabled: true, method: 'GET', urlPattern: '/api/items/:id' }),
    ];

    it('should match exact path and method', () => {
      const result = findMockRule(rules, 'GET', 'https://example.com/api/users');
      expect(result?.id).toBe('1');
    });

    it('should match POST method', () => {
      const result = findMockRule(rules, 'POST', 'https://example.com/api/users');
      expect(result?.id).toBe('2');
    });

    it('should match wildcard method', () => {
      const result = findMockRule(rules, 'DELETE', 'https://example.com/api/users/123');
      expect(result?.id).toBe('3');
    });

    it('should skip disabled rules', () => {
      const result = findMockRule(rules, 'GET', 'https://example.com/api/disabled');
      expect(result).toBeNull();
    });

    it('should match path params with :param', () => {
      const result = findMockRule(rules, 'GET', 'https://example.com/api/items/42');
      expect(result?.id).toBe('5');
    });

    it('should return null when no match', () => {
      const result = findMockRule(rules, 'GET', 'https://example.com/api/unknown');
      expect(result).toBeNull();
    });

    it('should handle URL without domain', () => {
      const result = findMockRule(rules, 'GET', '/api/users');
      expect(result?.id).toBe('1');
    });
  });

  describe('generateMockResponse', () => {
    it('should generate response with correct status', async () => {
      const rule = createMockRule({
        statusCode: 201,
        body: '{"id": 1}',
        delay: 0,
      });
      const res = await generateMockResponse(rule);
      expect(res.status).toBe(201);
      expect(res.statusText).toBe('Created');
      expect(res.body).toBe('{"id": 1}');
      expect(res.headers['x-mock']).toBe('true');
    });

    it('should include custom headers', async () => {
      const rule = createMockRule({
        statusCode: 200,
        body: 'ok',
        delay: 0,
        headers: [{ id: '1', key: 'X-Custom', value: 'test', enabled: true }],
      });
      const res = await generateMockResponse(rule);
      expect(res.headers['X-Custom']).toBe('test');
    });

    it('should respect delay', async () => {
      const rule = createMockRule({
        statusCode: 200,
        body: 'ok',
        delay: 100,
      });
      const start = Date.now();
      await generateMockResponse(rule);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });
});

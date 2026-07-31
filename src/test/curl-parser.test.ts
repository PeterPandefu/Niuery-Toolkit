import { describe, it, expect } from 'vitest';
import { parseCurl, toCurl } from '@/lib/curl-parser';
import { createRequest } from '@/store/api-tester-store';

describe('curl-parser', () => {
  describe('parseCurl', () => {
    it('should parse a simple GET request', () => {
      const result = parseCurl("curl https://api.example.com/users");
      expect(result.method).toBe('GET');
      expect(result.url).toBe('https://api.example.com/users');
    });

    it('should parse method with -X flag', () => {
      const result = parseCurl("curl -X POST https://api.example.com/users");
      expect(result.method).toBe('POST');
      expect(result.url).toBe('https://api.example.com/users');
    });

    it('should parse headers', () => {
      const result = parseCurl(
        `curl -H 'Content-Type: application/json' -H 'Authorization: Bearer token123' https://api.example.com`
      );
      expect(result.headers).toHaveLength(2);
      expect(result.headers[0].key).toBe('Content-Type');
      expect(result.headers[0].value).toBe('application/json');
      expect(result.headers[1].key).toBe('Authorization');
      expect(result.headers[1].value).toBe('Bearer token123');
    });

    it('should parse body with -d flag', () => {
      const result = parseCurl(
        `curl -X POST -d '{"name":"test"}' https://api.example.com/users`
      );
      expect(result.body.type).toBe('json');
      expect(result.body.content).toBe('{"name":"test"}');
    });

    it('should auto-set POST method when body is present', () => {
      const result = parseCurl(
        `curl -d '{"name":"test"}' https://api.example.com/users`
      );
      expect(result.method).toBe('POST');
    });

    it('should parse basic auth', () => {
      const result = parseCurl(
        `curl -u admin:password123 https://api.example.com`
      );
      expect(result.auth.type).toBe('basic');
      expect(result.auth.basicUsername).toBe('admin');
      expect(result.auth.basicPassword).toBe('password123');
    });

    it('should parse query params from URL', () => {
      const result = parseCurl(
        `curl 'https://api.example.com/users?page=1&limit=10'`
      );
      expect(result.url).toBe('https://api.example.com/users');
      expect(result.params).toHaveLength(2);
      expect(result.params[0].key).toBe('page');
      expect(result.params[0].value).toBe('1');
      expect(result.params[1].key).toBe('limit');
      expect(result.params[1].value).toBe('10');
    });

    it('should handle multiline curl with backslash', () => {
      const result = parseCurl(
        `curl -X PUT \\\n  -H 'Content-Type: application/json' \\\n  https://api.example.com/users/1`
      );
      expect(result.method).toBe('PUT');
      expect(result.url).toBe('https://api.example.com/users/1');
      expect(result.headers).toHaveLength(1);
    });
  });

  describe('toCurl', () => {
    it('should generate a simple GET curl', () => {
      const req = createRequest({ method: 'GET', url: 'https://api.example.com/users' });
      const curl = toCurl(req);
      expect(curl).toContain("curl");
      expect(curl).toContain("'https://api.example.com/users'");
      expect(curl).not.toContain('-X');
    });

    it('should include method for non-GET requests', () => {
      const req = createRequest({ method: 'POST', url: 'https://api.example.com/users' });
      const curl = toCurl(req);
      expect(curl).toContain('-X POST');
    });

    it('should include headers', () => {
      const req = createRequest({
        method: 'GET',
        url: 'https://api.example.com',
        headers: [
          { id: '1', key: 'Accept', value: 'application/json', enabled: true },
        ],
      });
      const curl = toCurl(req);
      expect(curl).toContain("-H 'Accept: application/json'");
    });

    it('should include bearer token auth', () => {
      const req = createRequest({
        method: 'GET',
        url: 'https://api.example.com',
        auth: {
          type: 'bearer',
          bearerToken: 'mytoken',
          basicUsername: '',
          basicPassword: '',
          apiKeyName: '',
          apiKeyValue: '',
          apiKeyIn: 'header',
        },
      });
      const curl = toCurl(req);
      expect(curl).toContain("-H 'Authorization: Bearer mytoken'");
    });

    it('should include body for POST requests', () => {
      const req = createRequest({
        method: 'POST',
        url: 'https://api.example.com/users',
        body: { type: 'json', content: '{"name":"test"}', formData: [] },
      });
      const curl = toCurl(req);
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).toContain(`-d '{"name":"test"}'`);
    });

    it('should append query params to URL', () => {
      const req = createRequest({
        method: 'GET',
        url: 'https://api.example.com/users',
        params: [
          { id: '1', key: 'page', value: '1', enabled: true },
          { id: '2', key: 'disabled', value: 'x', enabled: false },
        ],
      });
      const curl = toCurl(req);
      expect(curl).toContain('page=1');
      expect(curl).not.toContain('disabled');
    });
  });
});

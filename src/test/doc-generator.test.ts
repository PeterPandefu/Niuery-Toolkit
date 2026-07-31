import { describe, it, expect } from 'vitest';
import { generateCollectionDoc, generateFullDoc, flattenRequests } from '@/lib/doc-generator';
import { createRequest, createCollection, type Collection } from '@/store/api-tester-store';

describe('doc-generator', () => {
  const sampleCollection: Collection = {
    id: 'col1',
    name: 'User API',
    items: [
      {
        type: 'request',
        data: createRequest({
          id: 'r1',
          name: 'Get Users',
          method: 'GET',
          url: 'https://api.example.com/users',
          params: [{ id: 'p1', key: 'page', value: '1', enabled: true }],
          headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
        }),
      },
      {
        type: 'request',
        data: createRequest({
          id: 'r2',
          name: 'Create User',
          method: 'POST',
          url: 'https://api.example.com/users',
          body: { type: 'json', content: '{"name": "John"}', formData: [] },
          auth: {
            type: 'bearer',
            bearerToken: '{{token}}',
            basicUsername: '',
            basicPassword: '',
            apiKeyName: '',
            apiKeyValue: '',
            apiKeyIn: 'header',
          },
        }),
      },
    ],
  };

  describe('generateCollectionDoc', () => {
    it('should generate markdown with collection name', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('# User API - API 文档');
    });

    it('should include request method and URL', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('**GET** `https://api.example.com/users`');
      expect(doc).toContain('**POST** `https://api.example.com/users`');
    });

    it('should include query params table', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('| `page` | 1 | |');
    });

    it('should include headers table', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('| `Accept` | application/json |');
    });

    it('should include auth info', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('Bearer Token');
    });

    it('should include request body', () => {
      const doc = generateCollectionDoc(sampleCollection);
      expect(doc).toContain('```json');
      expect(doc).toContain('{"name": "John"}');
    });
  });

  describe('generateFullDoc', () => {
    it('should return empty doc for no collections', () => {
      const doc = generateFullDoc([]);
      expect(doc).toContain('暂无接口');
    });

    it('should generate single collection doc directly', () => {
      const doc = generateFullDoc([sampleCollection]);
      expect(doc).toContain('# User API - API 文档');
    });

    it('should generate TOC for multiple collections', () => {
      const col2: Collection = { ...createCollection('Order API'), id: 'col2' };
      const doc = generateFullDoc([sampleCollection, col2]);
      expect(doc).toContain('## 目录');
      expect(doc).toContain('**User API**');
      expect(doc).toContain('**Order API**');
    });
  });

  describe('flattenRequests', () => {
    it('should extract requests from flat items', () => {
      const result = flattenRequests(sampleCollection.items);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Get Users');
      expect(result[1].name).toBe('Create User');
    });

    it('should extract requests from nested folders', () => {
      const nested: Collection = {
        id: 'nested',
        name: 'Nested',
        items: [
          {
            type: 'folder',
            data: {
              id: 'folder1',
              name: 'Sub Folder',
              items: [
                { type: 'request', data: createRequest({ id: 'r3', name: 'Deep Request' }) },
              ],
            },
          },
        ],
      };
      const result = flattenRequests(nested.items);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Deep Request');
    });

    it('should return empty for empty items', () => {
      const result = flattenRequests([]);
      expect(result).toHaveLength(0);
    });
  });
});

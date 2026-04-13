/**
 * conversationStorage 测试
 * 验证按 cwd 隔离的存储逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveMessages,
  loadMessages,
  loadMessagesPaginated,
  getTotalMessageCount,
  PAGE_SIZE,
} from '@/lib/conversationStorage';
import type { Message } from '@/types';

// 模拟 localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: (key: string) => localStorageMock.store[key] || null,
  setItem: (key: string, value: string) => { localStorageMock.store[key] = value; },
  removeItem: (key: string) => { delete localStorageMock.store[key]; },
  clear: () => { localStorageMock.store = {}; },
  get length() { return Object.keys(localStorageMock.store).length; },
  key: (index: number) => Object.keys(localStorageMock.store)[index] || null,
};

vi.stubGlobal('localStorage', localStorageMock);

describe('conversationStorage', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('存储 key 隔离', () => {
    it('应该按 cwd 隔离消息', () => {
      const messagesA: Message[] = [
        { id: '1', role: 'user', content: 'Project A', createdAt: new Date() },
      ];
      const messagesB: Message[] = [
        { id: '1', role: 'user', content: 'Project B', createdAt: new Date() },
      ];

      saveMessages('agent1', messagesA, '/project/A');
      saveMessages('agent1', messagesB, '/project/B');

      const loadedA = loadMessages('agent1', '/project/A');
      const loadedB = loadMessages('agent1', '/project/B');

      expect(loadedA[0].content).toBe('Project A');
      expect(loadedB[0].content).toBe('Project B');
    });

    it('空 cwd 和非空 cwd 应该使用不同 key', () => {
      const testMessages: Message[] = [
        { id: '1', role: 'user', content: 'Hello', createdAt: new Date() },
      ];
      
      saveMessages('agent1', testMessages);  // 无 cwd
      saveMessages('agent1', [], '/project');  // 有 cwd，空消息

      const noCwd = loadMessages('agent1');
      const withCwd = loadMessages('agent1', '/project');

      expect(noCwd).toHaveLength(1);
      expect(withCwd).toHaveLength(0);
    });
  });

  describe('分页加载', () => {
    it('应该正确分页', () => {
      const messages: Message[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        createdAt: new Date(2024, 0, 1, 0, i),
      }));

      saveMessages('agent1', messages, '/test');

      const total = getTotalMessageCount('agent1', '/test');
      expect(total).toBe(100);

      // 加载第一页（最新的 PAGE_SIZE 条）
      const page1 = loadMessagesPaginated('agent1', 0, PAGE_SIZE, '/test');
      expect(page1).toHaveLength(PAGE_SIZE);
    });
  });
});

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import {
  BROWSER_LAUNCH_ARGS,
  BROWSER_PROFILE_CACHE_DIR,
  CHROME_USER_DATA_DIRS,
  CONTEXT_TTL_MS,
  DEFAULT_BROWSER_CHANNEL,
  MAX_CONTEXTS,
} from './constants.js'
import { applyStealthToContext, getStealthUserAgent, STEALTH_ARGS } from './stealth.js'

interface SessionEntry {
  context: BrowserContext
  page: Page
  lastUsedAt: number
  /** persistent 模式下 context 由 pool 统一管理，关闭 session 时不关闭 context */
  ownedContext: boolean
}

// ============ 路径工具 ============

/** 展开 ~ 为实际 home 目录 */
function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2))
  }
  // Windows %LOCALAPPDATA% 展开
  if (p.startsWith('%LOCALAPPDATA%')) {
    const localAppData = process.env['LOCALAPPDATA'] ?? ''
    return p.replace('%LOCALAPPDATA%', localAppData)
  }
  return p
}

/** 获取当前平台对应的 Chrome 默认 user data 目录 */
function getDefaultChromeUserDataDir(): string | null {
  const platform = process.platform as keyof typeof CHROME_USER_DATA_DIRS
  const raw = CHROME_USER_DATA_DIRS[platform]
  if (!raw) return null
  return expandHome(raw)
}

/** 递归复制目录 */
function copyDirSync(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true, force: true })
}

/** 清洗 profileId，防止目录遍历和非法字符 */
function sanitizeProfileId(profileId: string): string {
  // 替换路径分隔符、控制字符、连续点为安全字符
  return profileId
    .replace(/[\\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim() || 'default'
}

/**
 * 获取 BrowserTool 使用的 profile 目录（优先使用环境变量）。
 * 为了向后兼容，如果检测到旧版单目录 `~/.claude/browser-profile` 存在，
 * 且新版 `browser-profiles/default` 尚不存在，则自动迁移旧目录。
 */
function resolveBrowserProfileDir(profileId: string): string {
  const envDir = process.env['BROWSER_USER_DATA_DIR']
  const rootDir = envDir ? expandHome(envDir) : expandHome(BROWSER_PROFILE_CACHE_DIR)
  const resolved = path.join(rootDir, sanitizeProfileId(profileId))

  // 向后兼容：迁移旧版单目录到新版 default profile
  if (!envDir && profileId === 'default') {
    const legacyDir = expandHome('~/.claude/browser-profile')
    if (fs.existsSync(legacyDir) && !fs.existsSync(resolved)) {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.renameSync(legacyDir, resolved)
        console.log(`[BrowserPool] 已自动迁移旧版 profile 目录: ${legacyDir} -> ${resolved}`)
      } catch (err) {
        console.warn(`[BrowserPool] 自动迁移旧版 profile 目录失败: ${err}`)
      }
    }
  }

  return resolved
}

/**
 * 判断是否应启用 persistent context 模式。
 *
 * 启用条件：
 * - 显式设置了 BROWSER_USER_DATA_DIR，或
 * - BROWSER_PERSISTENT=true，或
 * - 默认策略：系统 Chrome 可用时自动使用 persistent（即未设置 BROWSER_PERSISTENT=false）
 *
 * 禁用条件：
 * - BROWSER_PERSISTENT=false（强制使用 headless 标准模式）
 */
function shouldUsePersistentContext(): boolean {
  const flag = process.env['BROWSER_PERSISTENT']
  if (flag === 'false' || flag === '0') return false
  if (flag === 'true' || flag === '1') return true
  // 有明确的 user data dir 指定 → 使用 persistent
  if (process.env['BROWSER_USER_DATA_DIR']) return true
  // 默认：开启 persistent（使用系统 Chrome + 独立 profile）
  return true
}

// ============ Launch 选项构建 ============

interface LaunchOptions {
  channel?: string
  executablePath?: string
  headless: boolean
  args: string[]
}

/**
 * 根据环境变量构建启动选项。
 *
 * 优先级：
 * 1. BROWSER_EXECUTABLE_PATH → executablePath
 * 2. BROWSER_CHANNEL → channel
 * 3. 默认 → channel: DEFAULT_BROWSER_CHANNEL ('chrome')，失败时由调用方 fallback
 */
function buildLaunchOptions(headless: boolean): LaunchOptions {
  const executablePath = process.env['BROWSER_EXECUTABLE_PATH']
  const channelEnv = process.env['BROWSER_CHANNEL']

  const base: LaunchOptions = {
    headless,
    args: [...BROWSER_LAUNCH_ARGS, ...STEALTH_ARGS],
  }

  if (executablePath) {
    return { ...base, executablePath }
  }
  if (channelEnv) {
    return { ...base, channel: channelEnv }
  }
  // 默认使用系统 Chrome
  return { ...base, channel: DEFAULT_BROWSER_CHANNEL }
}

// ============ BrowserPool ============

class BrowserPool {
  /** 标准模式下的 Browser 单例 */
  private browser: Browser | null = null

  /**
   * Persistent 模式下的 BrowserContext 池。
   * key 为 profileId，每个 profile 拥有独立的 BrowserContext（独立的 Chrome 进程和 Cookie）。
   */
  private persistentContexts: Map<string, BrowserContext> = new Map()

  private sessions: Map<string, SessionEntry> = new Map()

  // -------- 标准模式（headless，无登录态持久化） --------

  /**
   * 获取或创建标准模式 Browser 单例。
   * 优先使用系统 Chrome，失败时 fallback 到 Playwright Chromium。
   */
  private async getStandardBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser
    }

    const { chromium } = await import('playwright')
    const opts = buildLaunchOptions(true)

    try {
      this.browser = await chromium.launch(opts)
    } catch (err) {
      // 如果系统 Chrome 不可用（channel 模式），fallback 到 Playwright bundled Chromium
      if (opts.channel && !opts.executablePath) {
        console.warn(
          `[BrowserPool] 系统 Chrome (channel: ${opts.channel}) 启动失败，回退到 Playwright Chromium。错误: ${err}`,
        )
        this.browser = await chromium.launch({
          headless: true,
          args: [...BROWSER_LAUNCH_ARGS, ...STEALTH_ARGS],
        })
      } else {
        throw err
      }
    }

    return this.browser
  }

  // -------- Persistent 模式（有界面，登录态持久化） --------

  /**
   * 确保 profile 目录存在，并设置严格权限（仅所有者可读写）。
   */
  private ensureProfileDir(profileDir: string): void {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
    } else {
      try {
        fs.chmodSync(profileDir, 0o700)
      } catch {
        // 忽略权限修改失败
      }
    }
  }

  /**
   * 尝试从系统 Chrome 的 Default profile 同步登录态数据到独立 profile。
   *
   * 策略：
   * - 仅在目标 profile 尚未拥有核心登录态文件（Cookies / Login Data）时进行同步，
   *   避免覆盖用户在独立 Chrome 中已保存的更新登录态。
   * - 如果系统 Chrome 正在运行导致文件锁定，则跳过并记录日志（best-effort）。
   */
  private syncChromeProfile(profileDir: string): void {
    const systemDir = getDefaultChromeUserDataDir()
    if (!systemDir) return

    const sourceDefault = path.join(systemDir, 'Default')
    if (!fs.existsSync(sourceDefault)) return

    const targetDefault = path.join(profileDir, 'Default')
    const isFreshProfile = !fs.existsSync(targetDefault) ||
      (!fs.existsSync(path.join(targetDefault, 'Cookies')) &&
       !fs.existsSync(path.join(targetDefault, 'Login Data')))

    if (!isFreshProfile) {
      console.log('[BrowserPool] 独立 profile 已存在登录态，跳过系统 Chrome 同步')
      return
    }

    fs.mkdirSync(targetDefault, { recursive: true, mode: 0o700 })

    const filesToSync = ['Cookies', 'Login Data', 'Login Data For Account']
    const dirsToSync = ['Local Storage', 'Network', 'Sessions']

    for (const file of filesToSync) {
      const src = path.join(sourceDefault, file)
      const dst = path.join(targetDefault, file)
      if (!fs.existsSync(src)) continue
      try {
        fs.copyFileSync(src, dst)
        console.log(`[BrowserPool] 已同步 ${file}`)
      } catch (err) {
        console.warn(`[BrowserPool] 同步 ${file} 失败（可能被锁定）: ${err}`)
      }
    }

    for (const dir of dirsToSync) {
      const src = path.join(sourceDefault, dir)
      const dst = path.join(targetDefault, dir)
      if (!fs.existsSync(src)) continue
      try {
        copyDirSync(src, dst)
        console.log(`[BrowserPool] 已同步 ${dir}`)
      } catch (err) {
        console.warn(`[BrowserPool] 同步 ${dir} 失败（可能被锁定）: ${err}`)
      }
    }
  }

  /**
   * 获取或创建指定 profile 的 Persistent BrowserContext。
   * 使用系统 Chrome + 独立 profile 目录，以 headed 模式运行，支持登录态持久化。
   *
   * 架构说明：
   * - launchPersistentContext 直接返回 BrowserContext，没有独立的 Browser 对象
   * - 每个 profileId 拥有独立的 persistent context（多租户隔离）
   * - 同一 profile 内的多个 BrowserTool session 通过在同一 context 内开新 Page 来并发
   */
  private async getPersistentContext(profileId: string): Promise<BrowserContext> {
    const existing = this.persistentContexts.get(profileId)
    if (existing) {
      return existing
    }

    const { chromium } = await import('playwright')
    const profileDir = resolveBrowserProfileDir(profileId)
    this.ensureProfileDir(profileDir)
    this.syncChromeProfile(profileDir)

    const opts = buildLaunchOptions(false) // persistent 模式强制 headed

    let context: BrowserContext
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        ...opts,
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        userAgent: getStealthUserAgent(),
      })
    } catch (err) {
      // 系统 Chrome 不可用时，尝试用 Playwright bundled Chromium + persistent
      if (opts.channel && !opts.executablePath) {
        console.warn(
          `[BrowserPool] 系统 Chrome persistent context 启动失败，回退到 Playwright Chromium。错误: ${err}`,
        )
        context = await chromium.launchPersistentContext(profileDir, {
          headless: false,
          args: [...BROWSER_LAUNCH_ARGS, ...STEALTH_ARGS],
          ignoreDefaultArgs: ['--enable-automation'],
          viewport: { width: 1920, height: 1080 },
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          userAgent: getStealthUserAgent(),
        })
      } else {
        throw err
      }
    }

    this.persistentContexts.set(profileId, context)

    // 注入反检测初始化脚本（在任何页面代码执行前运行）
    await applyStealthToContext(context)

    return context
  }

  // -------- 公共接口 --------

  /**
   * 获取指定 session 的 Page 实例。
   * - 同一 (profileId, sessionId) 始终返回同一个 Page
   * - 如果 Page 已关闭，自动创建新的
   * - 调用前自动执行驱逐检查
   *
   * 模式选择：
   * - persistent 模式（默认）：使用系统 Chrome + 独立 profile，headed，登录态持久化
   * - 标准模式（BROWSER_PERSISTENT=false）：headless，无登录态持久化
   */
  async getPage(sessionId: string, profileId?: string): Promise<Page> {
    await this.evictStaleContexts()
    await this.evictLRU()
    await this.evictIdlePersistentContexts()

    const resolvedProfileId = profileId ?? 'default'
    const sessionKey = `${resolvedProfileId}::${sessionId}`

    const existing = this.sessions.get(sessionKey)
    if (existing && !existing.page.isClosed()) {
      existing.lastUsedAt = Date.now()
      return existing.page
    }

    if (shouldUsePersistentContext()) {
      return this.getPageFromPersistentContext(sessionKey, resolvedProfileId)
    }
    return this.getPageFromStandardBrowser(sessionKey)
  }

  /** 标准模式：创建新 context + page */
  private async getPageFromStandardBrowser(sessionId: string): Promise<Page> {
    const browser = await this.getStandardBrowser()
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      userAgent: getStealthUserAgent(),
    })

    // 注入反检测初始化脚本（在任何页面代码执行前运行）
    await applyStealthToContext(context)

    const page = await context.newPage()
    page.setDefaultTimeout(30000)

    this.sessions.set(sessionId, {
      context,
      page,
      lastUsedAt: Date.now(),
      ownedContext: true,
    })
    return page
  }

  /** Persistent 模式：在指定 profile 的共享 context 内创建新 page */
  private async getPageFromPersistentContext(sessionKey: string, profileId: string): Promise<Page> {
    const context = await this.getPersistentContext(profileId)
    const page = await context.newPage()
    page.setDefaultTimeout(30000)

    this.sessions.set(sessionKey, {
      context,
      page,
      lastUsedAt: Date.now(),
      ownedContext: false, // context 由 pool 统一管理，session 关闭时不关闭 context
    })
    return page
  }

  /**
   * 关闭指定 session 的 Page（以及独立 context，如果 ownedContext 为 true）
   */
  async closeSession(sessionKey: string): Promise<void> {
    const entry = this.sessions.get(sessionKey)
    if (entry) {
      try {
        await entry.page.close()
        if (entry.ownedContext) {
          await entry.context.close()
        }
      } catch {
        // 忽略关闭错误
      }
      this.sessions.delete(sessionKey)
    }
  }

  /**
   * 清理没有活跃 session 的 persistent contexts，防止空转进程泄漏。
   */
  private async evictIdlePersistentContexts(): Promise<void> {
    const activeProfileIds = new Set<string>()
    for (const [, entry] of this.sessions) {
      if (!entry.ownedContext) {
        // 从 BrowserContext 反查 profileId
        for (const [pid, ctx] of this.persistentContexts) {
          if (ctx === entry.context) {
            activeProfileIds.add(pid)
            break
          }
        }
      }
    }

    for (const [profileId, context] of this.persistentContexts) {
      if (!activeProfileIds.has(profileId)) {
        try {
          await context.close()
        } catch {
          // 忽略关闭错误
        }
        this.persistentContexts.delete(profileId)
      }
    }
  }

  /**
   * 清理所有资源（进程退出时调用）
   */
  async cleanup(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.closeSession(sessionId)
    }

    // 关闭所有 persistent contexts
    for (const [profileId, context] of this.persistentContexts) {
      try {
        await context.close()
      } catch {
        // 忽略关闭错误
      }
      this.persistentContexts.delete(profileId)
    }

    // 关闭标准 browser
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        // 忽略关闭错误
      }
      this.browser = null
    }
  }

  /**
   * 驱逐超过 TTL 的 session 及其所属的空闲 persistent contexts
   */
  private async evictStaleContexts(): Promise<void> {
    const now = Date.now()
    const staleIds: string[] = []
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastUsedAt > CONTEXT_TTL_MS) {
        staleIds.push(id)
      }
    }
    for (const id of staleIds) {
      await this.closeSession(id)
    }
    await this.evictIdlePersistentContexts()
  }

  /**
   * LRU 驱逐：超过 MAX_CONTEXTS 时清理最久未使用的 session 及其空闲 persistent contexts
   */
  private async evictLRU(): Promise<void> {
    const extra = this.sessions.size - MAX_CONTEXTS
    if (extra <= 0) return

    const sorted = [...this.sessions.entries()].sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
    )
    const toEvict = sorted.slice(0, extra)
    for (const [id] of toEvict) {
      await this.closeSession(id)
    }
    await this.evictIdlePersistentContexts()
  }

  /**
   * 获取当前活跃的 session 数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size
  }

  /**
   * 获取当前运行模式描述（用于日志/调试）
   */
  getMode(): string {
    if (shouldUsePersistentContext()) {
      const profileDir = resolveBrowserProfileDir('default')
      const channel = process.env['BROWSER_CHANNEL'] ?? DEFAULT_BROWSER_CHANNEL
      return `persistent (channel: ${channel}, profile root: ${profileDir})`
    }
    const opts = buildLaunchOptions(true)
    return `standard headless (${opts.channel ? `channel: ${opts.channel}` : opts.executablePath ?? 'playwright chromium'})`
  }

  /**
   * 返回指定 profile 的目录路径（persistent 模式下有效）
   */
  getProfileDir(profileId?: string): string | null {
    if (shouldUsePersistentContext()) {
      return resolveBrowserProfileDir(profileId ?? 'default')
    }
    return null
  }

  /**
   * 返回系统 Chrome 默认 user data 目录（供参考，不直接使用）
   */
  getDefaultChromeUserDataDir(): string | null {
    return getDefaultChromeUserDataDir()
  }
}

// 全局单例
export const browserPool = new BrowserPool()

/**
 * 清理浏览器池资源（供 sidecar entry 的 SIGTERM 处理调用）
 */
export async function cleanupBrowserPool(): Promise<void> {
  await browserPool.cleanup()
}

# F-Nav 个人导航

> [!NOTE]
> **本仓库是 [eallion/favorite](https://github.com/eallion/favorite)（蜗牛个人导航）的二次定制分支**，在保留原分类加密、私人书签、TOTP、多平台部署等能力的基础上，做了如下 UI / 性能定制：
>
> - **双卡片视图**：简约 = 正方形小图标卡片（80px 网格、一排标题、不展示描述）；详情 = 长方形横排卡片（图标 + 标题 + 描述）
> - **首屏加载**：居中圆形 spinner + "Nav" 文字，加载完成后淡出
> - **右下角回到顶部按钮**
> - **抓取描述按钮**：创建/编辑链接时一键读取目标页 `<title>` 与 `<meta name="description">` 自动填充描述（无需 AI）
> - **移动端安全区适配**：viewport `viewport-fit=cover` + `dvh` 视口，修复 iOS Safari 弹窗留白/贴边
> - **性能优化**：lucide-react 显式按需引入（首屏图标 chunk 由 ~560KB 降至 ~30KB）、LinkCard `React.memo`
>
> 原项目：[eallion/favorite](https://github.com/eallion/favorite)

> [!IMPORTANT]
> **v1.1.16（2026-11）更新概要**
>
> - **移除分类密码**：分类管理编辑加密分类时新增“移除密码”勾选项，保存后该分类不再需要密码；此前清空密码框保存仍会保留旧密码。
> - **本地导入下拉紧凑化**：本地导入区域的合并/覆盖选择框改为自定义箭头、桌面宽度 76px、高度 36px，与密码框/导入按钮完全对齐。
> - **WebDAV 下载稳定性**：外部 WebDAV 请求自动重试（最多 3 次）与 20 秒超时。
> - **HTTP 局域网加密兼容**：Web Crypto + 纯 JS（@noble/hashes + @noble/ciphers）双实现，HTTP 局域网下同样可以加密/解密，格式完全兼容。
> - **移动端适配**：本地导出/导入 JSON 的密码输入框与按钮改为上下堆叠、整行宽度，不再溢出或被裁切；WebDAV 操作按钮在手机端自动换行。
> - **本地加密备份**：导出/导入 JSON 均支持备份密码；填写则加密导出（PBKDF2 + AES-GCM），留空则使用明文，导入时未加密文件留空即可恢复。
> - **WebDAV 文件下载**：备份列表新增“下载”按钮，可将云端加密备份保存到本地，再通过本地导入输入密码恢复。
> - **WebDAV 备份**：服务器地址与备份路径分离；新增备份密码；测试连接 / 保存配置 / 立即备份；最近 5 条备份列表与指定恢复。
> - **分类解锁即时显示**：输入分类密码后立即合并该分类书签，不再需要手动刷新页面；匿名/登录态均生效。
> - **界面**：三个管理弹窗统一尺寸；新增打开/关闭动效；弹窗滚动条隐藏；Toast 移至左上角并改为 70% 半透明毛玻璃；简约 ↔ 详情卡片形变动画；添加链接表单增加空值校验；四个弹窗支持 Esc 关闭、焦点陷阱与焦点恢复。
> - **性能**：静态资源启用 br/gzip（首屏 JS 379KB → 113KB）；四个 Context 的 value 增加 `useMemo`；卡片形变使用原生 Web Animations API，无新增依赖。
> - **安全**：favicon 写入鉴权与 SVG 安全响应、分类密码改用 HMAC 解锁令牌、SSRF DNS/IP 校验、登录限流改用真实 IP、请求体/上传 2MB 上限、安全响应头统一、浏览器扩展 CORS 白名单、移除“密码当 Bearer”。
> - **扩展白名单**：`ALLOWED_EXTENSION_IDS` 新增 `off` / `*` / `all`，可临时放行所有 Chrome/Firefox 扩展；不填仍默认拒绝。
> - **单设备会话隔离**：网页与浏览器扩展各自维护 Token，扩展保存链接不再把网页踢下线（扩展 1.1.2）。
> - **多平台**：EdgeOne Makers 适配（自动生成 `cloud-functions/`）、Cloudflare Functions 构建验证通过、Vercel `api/*.ts` 同步安全修复与扩展 CORS。
> - **注意**：自 v1.1.2 起管理员密码已轮换，旧密码与旧会话全部失效；自 v1.1.3 起打包版本按 v1.1.4…v1.1.7 依次递增（当前 v1.1.7）。

> [!NOTE]
> **基于 EdgeOne Pages 开发。对 Cloudflare Pages 和 Vercel 只进行过简单地测试。**

**一个现代化云端导航 / 书签管理页面。**

![CloudNav Screenshot](screenshots/preview.png)

## ✨ 特性

- **全分类锚点页面**：所有分类同屏展示，侧边栏一键跳转
- **前端可视化编辑**：右键菜单 / 拖拽排序 / 批量操作 / 分类管理
- **访客模式**：普通用户可正常浏览，登录后获得管理权限
- **KV 按分类存储**：链接按 `links:{category_id}` 拆分存储，读取时自动聚合
- **多平台部署**：EdgeOne Pages / Cloudflare Pages / Vercel 一键部署
- **KV 云端存储**：数据持久化，localStorage 缓存 + KV 双向同步
- **图标缓存**：可抓取网站图标并缓存到 EdgeOne Pages Blob / Cloudflare R2
- **AI 辅助**：集成 Gemini / OpenAI 兼容 API，自动填充链接描述、智能分类建议
- **数据导入导出**：Chrome 书签 HTML / JSON 备份 / WebDAV 云同步
- **丰富小组件**：Mastodon / Memos 动态滚动条、实时天气（和风天气）
- **个性化**：深色/浅色模式（自动检测系统偏好）、简约正方形小卡片 / 详情长方形卡片双视图、自定义图标
- **卡片动效**：从标题生成主色调作为图标底色，hover 高亮
- **加载动画**：首屏居中 spinner + "Nav" 文字，加载完成淡出；卡片淡入
- **弹窗体验**：设置 / 分类 / 备份 / 添加链接统一尺寸与动效，支持 Esc 关闭、Tab 焦点循环、关闭后焦点恢复；滚动条隐藏但保留滚动
- **通知提示**：Toast 位于左上角，70% 半透明毛玻璃，自动进度条，暗色模式适配
- **视图形变**：简约/详情切换时卡片按 FLIP 连续位移、缩放、重排，支持“减少动态效果”系统设置
- **回到顶部**：长页面右下角悬浮回到顶部按钮
- **TOTP功能**：使用流程开启：设置 → 两步验证 → 点“开启两步验证”→ 显示 Base32 密钥（可一键复制）→ 在验证器 App 手动添加账户粘贴密钥 → 输入 App 上的 6 位码 → 确认开启 → 显示恢复码（仅此一次，务必保存）
（登录：输入密码 + 动态验证码，两个都对了才发 Token（单设备机制不变）
应急：手机丢失时用恢复码登录——一次性有效，使用后 TOTP 自动关闭，可重新设置
设计要点
防锁死：恢复码机制保证换手机/删 App 不会永久锁死；万一恢复码也丢了，还能去 EdgeOne KV 控制台手动删除 totp_secret、totp_recovery 两个键
两步确认：密钥先生成为 pending，输入正确动态码才激活，防止“生成了密钥但验证器没存上”导致锁死
时钟容差：允许 ±30 秒偏差，避免手机时间稍不准就验证失败
无新增依赖（纯 Web Crypto 实现），构建体积几乎不变
部署提醒
functions/api/ 是 EdgeOne 的边缘函数，必须随本次一起部署，否则前端的“开启”按钮会报错。部署后完整测试一遍：开启 → 退出登录 → 用密码+动态码登录 → 再用恢复码登录验证应急通道。）
  
## 🧩 浏览器插件

你可以配合 **Chrome** /  **Firefox** 浏览器插件来快速添加书签：

- [eallion/chrome-extension-favorite](https://github.com/eallion/chrome-extension-favorite)
- [eallion/firefox-extension-favorite](https://github.com/eallion/firefox-extension-favorite)

[![](screenshots/ChromeStore.png)](https://chromewebstore.google.com/detail/nepjakfedadjkpjpideoaobngonilmoi) [![](screenshots/FirefoxAddon.png)](https://addons.mozilla.org/zh-CN/firefox/addon/favorite-assistant/)

> **扩展接入配置（v1.1.2 起，v1.1.3 支持 off/*）**：CORS 改为扩展 ID 白名单，默认拒绝所有扩展跨源请求。请把扩展 ID 填入环境变量 `ALLOWED_EXTENSION_IDS`：
>
> - Chrome：扩展管理页 → 开发者模式 → 复制 32 位扩展 ID（如 `abcdefghijklmnopabcdefghijklmnop`）
> - Firefox：`about:debugging` → 复制 `moz-extension://` 后的 UUID
> - 多个用逗号分隔：`ALLOWED_EXTENSION_IDS=chromeid1,firefox-uuid`
>
> **临时放行所有扩展**：设置 `ALLOWED_EXTENSION_IDS=*`（或 `off` / `all`）即可放行任意 `chrome-extension://` / `moz-extension://` 源。这会让任意已安装扩展读取匿名 API 数据（书签标题/URL/分类等，私人书签仍被过滤；管理操作仍需 Token），仅建议调试或完全信任本机扩展时使用，用完请改回真实 ID 白名单。
>
> **扩展 1.1.2（v1.1.4 配套）**：扩展不再把管理密码直接当作 `x-auth-password` 发送，而是先调用 `/api/auth` 换取 Token，再以 `Authorization: Bearer <token>` 访问；Token 失效时会自动用保存的密码重新登录。登录请求携带 `client: 'extension'`，与网页会话隔离，保存链接不会导致网页退出。
>
> - **保存链接 401**：旧版扩展（≤1.1.0）或服务端清理过会话时会出现；请更新到扩展 1.1.2，并在 `chrome://extensions` 中重新加载解压目录。
> - **看不到私人书签**：私人书签只在有效 Token（登录态）下返回；Token 失效时服务端按匿名过滤，扩展会自动重登后恢复。
> - **CORS**：扩展已声明 `host_permissions`，一般不受 CORS 限制；若仍被拦截，请配置 `ALLOWED_EXTENSION_IDS`（或临时 `*`）。

## 🆕 版本与更新日志

### v1.1.16（2026-11，当前版本）

- 分类管理编辑加密分类时新增“移除密码”勾选项，保存后清除该分类密码（恢复为公开分类）
- 服务端分类保存支持 `clearPassword` 标记，三处保存分支统一处理；未勾选时仍保留原密码
- 修复此前“清空密码框保存后旧密码仍保留”的问题
- 勾选移除密码时密码输入框自动禁用，分类列表锁图标立即取消

### v1.1.15

- 本地导入区域的合并/覆盖下拉改为 `appearance-none` + 自定义 ChevronDown 箭头
- 桌面端下拉宽度收缩到 76px，去掉原生箭头造成的大块内部空白；手机端保持全宽
- 下拉高度统一 `h-9`（36px），与备份密码框、导入 JSON 按钮完全对齐

### v1.1.14

- 备份列表“合并/覆盖”下拉改为 `appearance-none` + 自定义 ChevronDown 箭头，去掉浏览器原生箭头造成的大块右端空白
- 下拉与下载/恢复/删除按钮统一 `h-7`（28px）高度与圆角，视觉对齐
- 移动端列表项保持换行布局，控件无溢出（390px 实测右侧最大 336px）

### v1.1.13

- WebDAV 备份列表每条新增“合并 / 覆盖”下拉，默认合并；恢复时按所选方式处理
- 本地导入 JSON 新增“合并 / 覆盖”下拉，默认合并
- 合并规则：分类与链接按 id 去重，本地数据优先，追加备份中新增项；覆盖则完全替换
- 合并模式不覆盖搜索/AI 配置，覆盖模式才会替换
- 云端备份列表新增“删除”按钮（二次确认）；后端新增 WebDAV `DELETE` 操作，删除后自动刷新列表
- 合并结果通过 `onRestore` 写回（合并模式相当于把本地+新增数据同步到云端）

### v1.1.12

- WebDAV 请求（check/list/upload/download）统一增加自动重试：最多 3 次，每次 20 秒超时，间隔 600ms
- 修复 InfiniCloud 等外部 WebDAV 偶发 `ConnectTimeoutError` 导致“下载失败”的问题（网络抖动时自动重试）
- 下载失败提示改为“WebDAV 连接超时或网络异常（已自动重试），请稍后再试”，便于区分密码/路径错误与网络问题
- 重试仅针对网络异常；SSRF 校验拦截不会重试

### v1.1.11

- 打开“备份与恢复”弹窗不再自动请求 WebDAV 列目录
- “刷新”按钮改为“加载备份”，只有点击时才发起 `list` 请求
- 保存配置只保存，不再自动触发测试连接；测试连接、立即备份、恢复/下载各自独立请求
- 列表空状态区分“未加载”（点击加载备份）与“已加载但无备份”
- 备份成功后提示点击“加载备份”刷新列表，不自动请求

### v1.1.10

- WebDAV 备份密码改为随配置持久化：点击“保存配置”后写入 `WebDavConfig.backupPassword`，刷新/重开弹窗仍保留
- 备份密码输入框直接绑定配置，不再使用临时 state
- 修复云端同步列表文件名不显示：`listBackups` 将后端返回的字符串数组映射为 `{ name }`，列表左侧正常显示文件名
- 说明：备份密码会保存在浏览器配置中（与 WebDAV 应用密码一起），如不希望持久化可清空后不点保存

### v1.1.9

- 修复 HTTP 局域网（非安全上下文）下加密导出报“备份加密失败”的问题
- 浏览器 `crypto.subtle` 不可用时自动回退到纯 JS 实现（PBKDF2 + AES-GCM），与 Web Crypto 密文格式完全兼容
- 新增依赖 `@noble/hashes`、`@noble/ciphers`（纯 JS，无 Web Crypto 依赖）
- HTTP 与 HTTPS、localhost 与局域网 IP 下的加密导出/导入均已验证

### v1.1.8

- 修复手机端“本地导出与恢复”布局：导出/导入 JSON 的密码输入框与按钮改为上下堆叠、整行宽度，标题与说明不再被挤压或裁切
- 导出 HTML / 导出 JSON / 导入 JSON 三行卡片统一响应式布局（桌面左右排列，手机上下排列）
- WebDAV 的测试连接/保存配置/立即备份按钮在手机端自动换行，立即备份独占一行

### v1.1.7

- 本地导出 JSON 新增“备份密码”：填写则加密导出（文件名 `cloudnav_backup_<时间戳>.json`），留空则导出明文 `cloudnav_backup.json`
- 本地导入 JSON 新增“备份密码”：加密文件输入密码解密；未加密文件留空即可导入
- WebDAV 备份列表新增“下载”按钮：可下载云端加密备份到本地，再通过本地导入恢复
- 导入加密文件时密码为空或错误会明确提示，不再出现“解析失败”

### v1.1.6

- WebDAV 设置新增“备份路径”“备份密码”，支持测试连接、保存配置、立即备份
- 备份文件名改为 `cloudnav_backup_<时间戳>.json`，使用备份密码加密（PBKDF2 + AES-GCM）
- 新增“最近 5 条备份”列表与指定文件恢复；支持刷新列表，云端旧文件不自动删除
- 后端 `/api/webdav` 新增 `list`（PROPFIND）与按文件名 `download`，上传支持自定义文件名与备份路径（防路径穿越）
- 旧 `cloudnav_backup.json` 不再在列表中展示（按选择只支持新格式）

### v1.1.5

- 分类密码验证成功后立即把该分类书签合并到当前页面（`CategoryAuthModal` 返回书签 → `handleCategoryUnlock` 更新 Links 状态与本地缓存），无需刷新
- 修复匿名访客解锁分类后不重新加载数据的问题（`useDataSync` 解锁状态变化即触发重载，不再要求登录态）
- 解锁弹窗与页面数据保持同步，避免后续写回覆盖

### v1.1.4

- 单设备会话按客户端类型隔离：网页（`web`）与浏览器扩展（`extension`）各自维护一个 Token
- 扩展登录请求携带 `client: 'extension'`，扩展保存链接不再踢掉网页登录；同一类型内仍保持单设备
- Vercel `api/auth.ts` 同步按客户端类型清理/记录 Token
- 扩展升级到 1.1.2（自动换 Token + 会话隔离）

### v1.1.3

- 浏览器扩展 CORS 白名单新增 `off` / `*` / `all` 语义：放行任意 `chrome-extension://` / `moz-extension://`（默认仍拒绝，开启后任意扩展可读取匿名数据，管理操作仍需 Token）
- Vercel `api/_kvHelper.ts` 的扩展 CORS 与 EdgeOne / Cloudflare / Docker 对齐（同样支持 ID 白名单与 `off` / `*`）
- README 更新环境变量、扩展接入、安全说明与发布包说明
- **版本规则**：自 v1.1.3 起每次打包递增（v1.1.4、v1.1.5…），更新日志按版本累积

### v1.1.2

**界面与交互**
- 设置面板、分类管理、备份与恢复统一为桌面 672×810 / 移动端 358×760，上下留白各 5dvh
- 修复移动端因 `z-[60]` 全局规则导致的上下留白不一致
- 修复设置面板“加载设置中”不在内容区居中的问题
- 新增弹窗打开（淡入 + 浮起 + 弹性放大）与关闭（淡出 + 下移缩小）动效
- 所有弹窗内容区隐藏滚动条（保留滚动能力）
- Toast 移至左上角，恢复原样式并改为 70% 半透明 + 40px 背景模糊，暗色同步
- 简约 ↔ 详情视图切换新增卡片形变动画（位移、缩放、重排，错峰 8ms）
- 添加链接弹窗新增标题/URL 空值错误状态与提示文案
- 新增弹窗无障碍：`role="dialog"`、`aria-modal`、Esc 关闭、Tab 焦点陷阱、焦点恢复

**性能**
- 静态资源启用 br/gzip 压缩，首屏 JS 传输 379KB → 113KB，总传输 471KB → 137KB
- Auth / Categories / Config / Links 四个 Context 的 value 使用 `useMemo`
- 卡片形变使用原生 Web Animations API，零新增依赖；支持 `prefers-reduced-motion`

**安全**
- favicon 写入接口必须鉴权，域名/内容长度校验；SVG 以 `nosniff + CSP sandbox` 返回
- 分类密码：服务端不再信任 `unlocked`，改为 HMAC 签名令牌（2 小时）
- SSRF：DNS 解析后逐 IP 拦截私网/环回/保留地址，重定向逐跳校验
- 登录限流使用真实 socket IP，限制限流表规模；密码不可直接作为 Bearer
- 请求体 2MB、上传 2MB、MIME 白名单、SVG 内容校验
- 静态路径 `realpath` 校验、书签导入仅 http/https、WebDAV 强制 HTTPS
- 安全响应头统一（CSP/HSTS/nosniff/X-Frame-Options/Referrer-Policy/Permissions-Policy）
- 浏览器扩展 CORS 改为 ID 白名单（`ALLOWED_EXTENSION_IDS`）；设为 `off` / `*` / `all` 时放行所有扩展（高风险，默认拒绝）
- 管理员密码已轮换，旧 Token 已清理

**多平台**
- EdgeOne Makers：构建时自动生成 `cloud-functions/`，安全头写入 `edgeone.json`
- Cloudflare Pages：`wrangler pages functions build` 验证通过；`_headers`/`_routes.json` 更新
- Vercel：`api/*.ts` 同步 favicon 鉴权、密码直通、`unlocked`、WebDAV HTTPS 修复

### v1.1.1

- 统一三个弹窗尺寸；修复移动端留白；加载提示居中；弹窗开关动效；隐藏弹窗滚动条；Toast 左上角与半透明；卡片形变动画
- 以上内容已全部包含在 v1.1.2 中

## 🏗️ 技术架构

#### 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS 4

#### Serverless / Storage

- **EdgeOne Pages**: Edge Functions + EdgeOne KV
- **Cloudflare Pages**: Pages Functions + Cloudflare KV
- **Vercel**: Vercel Functions + Vercel KV (Upstash Redis)

```
┌──────────────────────────────────────────────┐
│               Browser (Client)               │
│                                              │
│  React 19 + TypeScript + Tailwind CSS 4      │
│  State: Context + useReducer                 │
│  DnD: @dnd-kit                               │
│  Icons: lucide-react                         │
│                                              │
│  Data: localStorage (cache) + KV (persist)   │
└──────────────────┬───────────────────────────┘
                   │ HTTP API
┌──────────────────┴───────────────────────────┐
│     EdgeOne / Cloudflare / Vercel Backend    │
│                                              │
│  KV 存储：links:{category_id} 按分类拆分     │
│  认证：安全随机 Token + 自动清理旧 Token     │
│  平台适配：多平台 KV 接口抽象（屏蔽底层差异）│
└──────────────────────────────────────────────┘
```

## 🚀 部署指南

### EdgeOne Pages / EdgeOne Makers (推荐)

1. Fork 或克隆本仓库。
2. 在 EdgeOne 控制台创建 Pages / Makers 项目。
3. 构建设置：
   - 框架预设：`Vite`
   - 输出目录：`./dist`
   - 安装命令：`pnpm install`
   - 编译命令：`pnpm build && node scripts/prepare-edgeone.mjs`
4. 绑定 KV：创建 KV 命名空间，变量名称设为 `CLOUDNAV_KV`。
5. 环境变量：设置 `PASSWORD`（管理密码）；如需跨源访问（本地开发、备用域名、浏览器扩展等），设置 `ALLOWED_ORIGIN` / `ALLOWED_EXTENSION_IDS`，多个用逗号分隔。
6. 自托管图标与缓存：
   - 本项目支持使用 **EdgeOne Pages Blob 存储** 实现网站图标缓存及自定义上传。
   - **无需手动配置/创建存储空间**，EdgeOne Pages Blob 由 SDK 首次调用时**自动创建**（命名空间归属于当前项目）。
   - 支持在控制面板的“图标自托管与缓存”中开启/关闭自动抓取缓存（免费用户若担心存储空间超限可以关闭该选项，关闭后仅服务已上传的自定义图标与实时抓取而不写入缓存）。

> **EdgeOne Makers 目录说明**：`functions/` 是旧 Pages / Cloudflare 约定，EdgeOne Makers 需要 `edge-functions/`（边缘运行时）或 `cloud-functions/`（Node 运行时）。本项目构建命令会通过 `scripts/prepare-edgeone.mjs` 自动把 `functions/api` 复制到 `cloud-functions/api`，采用 Node 云函数以获得 2MB 请求体、DNS SSRF 校验和 Web Crypto 支持。若你更希望使用边缘函数，可把脚本目标改为 `edge-functions`，但需接受平台 **1MB 请求体 / 200ms CPU** 限制。
>
> 安全响应头已写入 `edgeone.json` 的 `headers`，无需额外配置 `_headers`。

### Cloudflare Pages

1. 在 Cloudflare 控制台创建 Pages 项目，连接 GitHub 仓库。
2. 构建设置：
   - 框架预设选择 `Other`
   - 安装命令 `pnpm install`
   - 输出目录 `dist`。
3. 创建并绑定 KV：
   - 导航至 **Workers & Pages** -> **KV** -> **Create a namespace**。
   - 名字设为 `CLOUDNAV_KV`。
   - 回到 Pages 项目设置 -> **Settings** -> **Functions** -> **KV namespace bindings**。
   - 添加绑定：变量名称设为 `CLOUDNAV_KV`，选择刚才创建的命名空间。
4. 环境变量：
   - 在项目设置 -> **Environment variables** 中添加 `PASSWORD`（管理密码）。
   - 如需跨源访问，添加 `ALLOWED_ORIGIN`（带协议的完整 Origin，多个用逗号分隔）。
5. 自托管图标与缓存：
   - 本项目支持使用 **Cloudflare R2 对象存储** 实现网站图标缓存及自定义上传。
   - 导航至 **Workers & Pages** -> **R2** -> **Create bucket**，名字设为 `CLOUDNAV_R2`（或者您喜欢的名字）。
   - 回到 Pages 项目设置 -> **Settings** -> **Functions** -> **R2 bucket bindings**。
   - 添加 R2 绑定：变量名称设为 `CLOUDNAV_R2`，选择刚才创建的 R2 存储桶。
   - 设置环境变量 `UPLOAD_PLATFORM` 值为 `cloudflare`。
   - 支持在控制面板的“图标自托管与缓存”中开启/关闭自动抓取缓存（免费用户若担心存储空间超限可以关闭该选项，关闭后仅服务已上传的自定义图标与实时抓取而不写入缓存）。
6. 重新部署。

### Vercel

1. 在 Vercel 控制台导入 GitHub 仓库，框架预设选择 `Vite`。
2. 创建并连接 KV：
   - 在项目顶部菜单点击 **Storage** -> **Create Database** -> **Upstash for Redis**。
   - 创建成功后，点击 **Connect** 按钮将其绑定 to 本项目。
   - Vercel 会自动注入 `KV_URL` 等环境变量。
3. 环境变量：
   - 在项目 **Settings** -> **Environment Variables** 中手动添加 `PASSWORD`。
   - 如需跨源访问，添加 `ALLOWED_ORIGIN`（带协议的完整 Origin，多个用逗号分隔）。
4. 重新部署。

### Docker（自托管）

支持把整个站点（前端 + API + 数据存储）打包为单个 Docker 容器，数据落在宿主机目录，适合 VPS / NAS / 内网自托管。

```bash
# 1. 准备环境变量（设置管理员密码）
cp .env.example.docker .env
#    编辑 .env，把 PASSWORD 改成你自己的强密码

# 2. 构建并启动（首次构建需拉取依赖，耗时几分钟）
docker compose up -d --build

# 3. 访问
#    http://<服务器IP>:8080
```

- **数据持久化**：书签、分类、配置、图标缓存放 `/data`（compose 已映射到宿主机 `./data`）。备份只需备份该目录。
- **改端口**：在 `.env` 中设置 `PORT=9090` 后重启。
- **升级**：`git pull` 后重新 `docker compose up -d --build`。
- **无 Docker Compose 时**：
  ```bash
  docker build -t fnav .
  docker run -d --name fnav -p 8080:8080 \
    -e PASSWORD=你的密码 \
    -e DATA_DIR=/data \
    -v $(pwd)/data:/data \
    --restart unless-stopped \
    fnav
  ```

> Docker 版将 KV 存储替换为文件系统实现（`server/index.js` 中的 `FileKV`），`functions/api/*` 的 Worker 逻辑原样复用（新增 `STORAGE_BACKEND=filesystem` 分支读写图标缓存）。线上 EdgeOne / Cloudflare / Vercel 部署不受影响。

## ⚙️ 环境变量

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `PASSWORD` | 管理后台登录密码 | 是 | - |
| `ALLOWED_ORIGIN` | 跨源访问白名单，多个用逗号分隔，**必须带协议**（如 `https://sq.y11.fun`）。不填则仅允许同源访问 | 否 | 仅同源（无 `*` 兜底） |
| `ALLOWED_EXTENSION_IDS` | 允许访问 API 的浏览器扩展 ID（Chrome 32 位 ID 或 Firefox UUID），多个用逗号分隔；设为 `off` / `*` / `all` 时放行所有扩展（高风险，仅调试或完全信任本机扩展时使用）。不填则拒绝所有扩展跨源请求 | 否 | 空（拒绝） |
| `CATEGORY_UNLOCK_SECRET` | 分类解锁令牌的 HMAC 密钥，不填则回退使用 `PASSWORD` | 否 | `PASSWORD` |
| `UPLOAD_PLATFORM` | 上传与图标存储平台，部署到 Cloudflare 时可设为 `cloudflare` | 否 | - |

**Docker 版额外变量**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口 | `8080` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `DATA_DIR` | KV 数据目录（容器内，建议挂载 volume） | `/data` |
| `STORAGE_BACKEND` | 固定为 `filesystem`，标识 Docker 文件存储分支 | `filesystem` |
| `TRUST_PROXY` | 设为 `1` 时才采信 `X-Forwarded-For` / `cf-connecting-ip`（前置可信反向代理时使用），默认使用 socket 真实 IP | 未设置 |
| `ALLOWED_EXTENSION_IDS` | 浏览器扩展 ID 白名单（Docker 下也可用） | 空（拒绝） |

## 🔒 安全加固说明（2026-10 更新）

本仓库已按安全评估报告完成全量加固，部署后请注意以下行为变化：

- **管理操作需登录**：配置读写、WebDAV 云同步、备份恢复、图标上传/删除等接口强制认证（`Authorization: Bearer <token>`）；访客浏览（链接/分类/图标/搜索）保持匿名可用，不受影响。
- **密码与会话**：管理员密码不再可直接作为 Bearer Token；仅 KV 中签发的会话 Token 有效。密码或 Token 泄漏后请立即修改密码并清理 `data/auth_token*`、`data/last_token*`。
- **分类密码保护**：服务端不再信任客户端 `unlocked` 列表；分类密码校验通过后签发 2 小时有效的 HMAC 令牌（`X-Category-Token`），后续请求需携带 `categoryTokens` 才返回受保护书签。
- **敏感配置保护**：AI 配置段（`apiKey` 等）匿名不可读取——单值请求返回 401，批量请求自动剔除该段；仅登录管理员可见（纵深防御：即使鉴权被绕过也不会返回密钥）。
- **登录防护**：登录失败 5 次后按 IP 指数退避限流（最长 5 分钟），并限制限流表规模；Node/Docker 默认不信任 `X-Forwarded-For`，仅 `TRUST_PROXY=1` 时采信代理头。
- **恢复码一次性使用**：恢复码登录后立即轮换，防止重放攻击。
- **SSRF 防护**：metadata 抓取、图标抓取与 WebDAV 代理仅允许公网地址；Node 部署会做 DNS 解析并逐 IP 拦截私网/环回/保留段，逐跳校验跳转目标；WebDAV 强制 HTTPS（localhost 除外）且必须登录后使用。
- **XSS/图标安全**：favicon 仅回显白名单图片类型，SVG 以 `image/svg+xml` + `nosniff` + `CSP: default-src 'none'; sandbox` 返回；上传限制 2MB、按 MIME 推导扩展名并校验 SVG 内容；Mastodon 内联 HTML 的允许标签内容会转义。
- **请求体与上传上限**：Node 服务器请求体上限 2MB（超出 413），上传文件上限 2MB，外部抓取上限 2MB。
- **安全响应头**：静态资源（`public/_headers`、`edgeone.json`、`vercel.json`）与 API 统一响应均启用 CSP、HSTS、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`；主题初始化脚本已外置为 `/theme-init.js`，CSP 不再需要 `script-src 'unsafe-inline'`。
- **CORS 白名单**：默认仅同源放行，跨源需在 `ALLOWED_ORIGIN` 中精确声明（无 `*` 兜底），浏览器扩展需在 `ALLOWED_EXTENSION_IDS` 中声明扩展 ID；设为 `off` / `*` / `all` 会放行所有扩展（高风险，仅调试用）。

> ⚠️ **部署提醒**：
> 1. EdgeOne / Cloudflare / Vercel 部署后，如需跨源访问请设置 `ALLOWED_ORIGIN=https://<你的域名>`；使用浏览器扩展时需设置 `ALLOWED_EXTENSION_IDS=<扩展ID>`（Chrome 32 位 ID / Firefox UUID）。
> 2. EdgeOne 安全头已写入 `edgeone.json`，Cloudflare/Netlify 走 `public/_headers`，Docker 由 `server/index.js` 注入，三端保持一致。
> 3. 分类密码解锁在 EdgeOne、Cloudflare、Docker 使用服务端签名令牌；Vercel API（`api/*.ts`）目前仅管理员可读取受密码分类，签名令牌方案尚未迁移。
> 4. 若曾泄漏过管理密码、会话 Token 或 AI Key，请立即吊销/修改并重新登录；发布包请排除 `.env` 与 `data/`。

## 🛠️ 本地开发

```bash
# 安装依赖
pnpm install

# 1. 启动 Vite 开发服务器 (localhost:3000，仅前端)
pnpm dev

# 2. 模拟 EdgeOne 环境（需安装 edgeone cli）
pnpm build
node scripts/prepare-edgeone.mjs   # 生成 cloud-functions/
edgeone makers dev                 # EdgeOne Makers CLI；旧版 Pages 可用 edgeone pages dev

# 3. 模拟 Cloudflare 环境 (需安装 wrangler)
pnpm build
wrangler pages dev ./dist --kv CLOUDNAV_KV

# 4. 模拟 Vercel 环境 (需安装 vercel cli)
# 需要先运行 vercel env pull .env.local 拉取云端 KV 变量
vercel dev
```

### 数据存储说明

- **KV Key 结构**：链接按分类拆分存储，key 格式为 `links:{category_id}`。
- **本地模拟**：EdgeOne 使用 CLI 模拟 KV；Vercel 需连接云端测试 KV 或使用 `kvMock.ts`。
- **首次部署**：系统会使用 `types.ts` 中的 `INITIAL_LINKS` 作为初始演示数据。

## 📁 项目结构

```
├── api/                       # Vercel Serverless Functions (TypeScript)
├── functions/api/             # Cloudflare Pages Functions / 旧 EdgeOne Pages Functions (JavaScript)
├── cloud-functions/           # EdgeOne Makers 云函数（构建时由 scripts/prepare-edgeone.mjs 生成，已 gitignore）
├── scripts/                   # 构建辅助脚本（prepare-edgeone.mjs）
├── components/                # 通用 UI 组件 (Modal, Toast, ErrorBoundary, 小组件等)
├── services/                  # 前端业务逻辑 (AI, 书签解析, 导出, WebDAV 等)
├── src/
│   ├── components/            # 核心业务组件 (layout, category, link)
│   ├── contexts/              # React Context 状态管理 (Auth, Links, Categories, Config)
│   ├── hooks/                 # 自定义 Hooks (Search, DragSort, DataSync, DialogClose, ModalA11y)
│   ├── utils/                 # 工具函数 (Config, Security, ColorExtractor, LayoutMorph)
│   └── constants/             # 常量定义
├── public/                    # 静态资源（含 theme-init.js、_headers、_routes.json）
├── server/                    # Docker / Node 原生 HTTP 服务器与 FileKV
├── App.tsx                    # 应用入口
├── types.ts                   # 类型定义 & 初始数据
├── vercel.json                # Vercel 部署配置
├── edgeone.json               # EdgeOne Pages / Makers 配置（含安全头）
└── package.json               # 项目依赖
```

## 📦 发布包说明

- 打包前执行：`pnpm build && node scripts/prepare-edgeone.mjs`
- 发布包不应包含：`.env`（含明文密码）、`data/`（含 Token 与运行数据）、`node_modules/`、`cloud-functions/`（构建生成）、`.wrangler/`
- 首次部署必须设置 `PASSWORD`；v1.1.2 已轮换密码并清理旧 Token，升级后需要重新登录
- 自 v1.1.3 起打包版本按 v1.1.4、v1.1.5… 依次递增，发布前同步更新 `package.json` 与 README 更新日志
- 若曾把旧版 `.env` 或 `data/` 打进包里，请立即修改密码并删除已分发的 Token

## Inspiration

- [CloudNav-abcd](https://github.com/aabacada/CloudNav-abcd)

## 📄 License

本项目采用 [GLWTPL License](https://github.com/me-shaon/GLWTPL) 开源。

```
GLWT（Good Luck With That，祝你好运）公共许可证
            版权所有© 除作者外的所有人

任何人都被允许复制、分发、修改、合并、销售、出版、再授权
或任何其它行为，但风险自负。

作者对这个项目中的代码的行为一无所知。
代码处于可用或不可用状态，没有第三种可能


                祝你好运公共许可证
            复制、分发和修改的条款和条件

  0. 只要你永远不要留下任何可以追踪到原作者的线索，
你就可以随心所欲地做任何事，因此，不能因此责怪或追究
原作者的责任。

在任何情况下，作者均不对因使用或与本软件有关的合同诉讼、
侵权或其他方式产生的任何索赔、损害或其他责任负责。

自求多福吧。
```

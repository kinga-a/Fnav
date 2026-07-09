# Bookmark Manager for EdgeOne Pages

一个功能完整的书签管理应用，部署在 EdgeOne Pages 上，使用 KV 存储持久化数据。

## 功能特性

- ✅ **KV 持久化存储** - 所有数据存储在 EdgeOne KV 中
- ✅ **密码保护** - 通过环境变量设置访问密码
- ✅ **私有书签** - 设置私有后需输入密码才能查看内容
- ✅ **置顶功能** - 置顶书签显示在分类最前面
- ✅ **自定义分类** - 支持创建和管理分类
- ✅ **顶部搜索** - 实时搜索标题、链接、描述
- ✅ **侧边栏** - 可展开/关闭的分类导航侧边栏
- ✅ **响应式设计** - 适配桌面和移动端
- ✅ **快捷键支持** - Ctrl+K 搜索, Ctrl+N 新建

## 项目结构

```
/
├── edge-functions/
│   └── [[default]].js    # 主入口文件 (API + SPA HTML)
├── edgeone.json          # EdgeOne 项目配置
└── README.md
```

## 部署步骤

### 1. 创建 KV Namespace

1. 登录 [EdgeOne Pages 控制台](https://pages.edgeone.ai)
2. 进入 **Storage → KV Storage**
3. 点击 **Create Namespace**，命名为 `bookmark-data`
4. 进入 namespace 详情，点击 **Bind Project**
5. 选择你的项目，Variable name 填写 `BOOKMARK_KV`

### 2. 设置环境变量

1. 进入项目 **Settings → Environment Variables**
2. 添加以下变量：
   - `AUTH_PASSWORD` = 你的访问密码（如 `your-secure-password`）
   - `AUTH_USERNAME` = 可选，用户名（默认 admin）
   - `KV_BINDING` = KV 绑定变量名（默认 `BOOKMARK_KV`，如绑定名不同需修改）

### 3. 部署代码

1. 将 `[[default]].js` 放入 `edge-functions/` 目录
2. 将 `edgeone.json` 放入项目根目录
3. 提交代码，EdgeOne Pages 会自动构建部署

### 4. 访问应用

部署完成后访问你的域名即可使用。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 返回 SPA 页面 |
| POST | `/api/auth` | 登录验证 |
| GET | `/api/bookmarks` | 获取所有书签 |
| POST | `/api/bookmarks` | 创建书签 |
| GET | `/api/bookmarks/:id` | 获取单个书签 |
| PUT | `/api/bookmarks/:id` | 更新书签 |
| DELETE | `/api/bookmarks/:id` | 删除书签 |
| GET | `/api/categories` | 获取分类列表 |
| POST | `/api/categories` | 创建分类 |

## 数据存储格式

### 书签 (Key: `bookmark:{id}`)
```json
{
  "id": "abc123",
  "title": "示例网站",
  "url": "https://example.com",
  "description": "这是一个示例",
  "category": "工具",
  "pinned": true,
  "isPrivate": false,
  "createdAt": "2026-07-09T10:00:00Z",
  "updatedAt": "2026-07-09T10:00:00Z"
}
```

### 分类 (Key: `categories`)
```json
["未分类", "工具", "学习", "娱乐"]
```

## 安全说明

- 私有书签在未验证状态下会显示模糊/锁定状态
- 验证通过后会将 token 存储在 localStorage
- 密码通过环境变量配置，不会暴露在代码中
- 建议定期更换密码并清理过期 token

## 快捷键

- `Ctrl + K` - 聚焦搜索框
- `Ctrl + N` - 新建书签
- `Esc` - 关闭弹窗/侧边栏

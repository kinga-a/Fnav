# EdgeOne Pages 书签管理器

## 功能特性

- ✅ KV 持久化存储（`BOOKMARK_KV`）
- ✅ 密码验证（`AUTH_PASSWORD` 环境变量）
- ✅ 书签私有/公开设置
- ✅ 书签置顶功能
- ✅ 自定义分类
- ✅ 顶部搜索
- ✅ 可折叠侧边栏分类筛选
- ✅ 创建/编辑/删除书签
- ✅ 响应式设计

## 文件结构

```
project-root/
├── edge-functions/
│   └── [[default]].js    # 主入口（API + SPA HTML）
└── package.json
```

## 部署步骤

### 1. 创建 EdgeOne Pages 项目
- 登录 [EdgeOne Makers 控制台](https://pages.edgeone.ai)
- 创建新项目，选择「空白项目」或导入 GitHub 仓库

### 2. 绑定 KV 命名空间
- 进入项目 → **KV 存储**
- 点击「绑定命名空间」
- **变量名称**填写：`BOOKMARK_KV`
- 选择或创建一个 KV 命名空间
- 点击「确定」保存

### 3. 设置环境变量
- 进入项目 → **项目设置** → **环境变量**
- 添加变量：
  - **变量名**：`AUTH_PASSWORD`
  - **变量值**：你的管理密码（例如 `your-secret-password`）
- 点击「保存」

### 4. 上传代码
将 `edge-functions/[[default]].js` 和 `package.json` 上传到项目根目录，然后部署。

### 5. 访问应用
部署完成后，访问分配的域名即可使用。

## 使用说明

| 场景 | 操作 |
|------|------|
| 访客浏览 | 无需登录，可查看所有公开书签 |
| 管理书签 | 点击右上角「登录」，输入密码后即可创建/编辑/删除 |
| 搜索 | 顶部搜索框实时过滤 |
| 分类筛选 | 点击左上角 ☰ 展开侧边栏，选择分类 |
| 新建书签 | 登录后点击「新建书签」，填写信息保存 |
| 编辑/删除 | 登录后鼠标悬停书签卡片，点击「编辑」或「删除」 |

## 数据模型

每个书签包含以下字段：

```json
{
  "id": "唯一ID",
  "title": "书签标题",
  "url": "https://example.com",
  "description": "描述文本",
  "category": "分类名称",
  "isPrivate": false,
  "isPinned": false,
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

## API 端点

| 方法 | 路径 | 说明 | 需认证 |
|------|------|------|--------|
| GET | `/api/bookmarks` | 获取书签列表（过滤私有） | 否 |
| POST | `/api/bookmarks` | 创建书签 | ✅ |
| GET | `/api/bookmarks/:id` | 获取单个书签 | 否（私有需认证） |
| PUT | `/api/bookmarks/:id` | 更新书签 | ✅ |
| DELETE | `/api/bookmarks/:id` | 删除书签 | ✅ |
| GET | `/api/categories` | 获取分类列表 | 否 |
| POST | `/api/auth` | 登录 | 否 |
| DELETE | `/api/auth` | 退出登录 | 否 |
| GET | `/api/auth/status` | 检查登录状态 | 否 |

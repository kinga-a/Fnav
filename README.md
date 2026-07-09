# EdgeOne Pages 书签管理器

## 文件结构

```
project-root/
├── cloudone/
│   └── [[default]].js      # 主程序（Cloud Functions）
└── package.json
```

## 部署步骤

1. 上传 `cloudone/[[default]].js` 到项目根目录的 `cloudone/` 文件夹
2. 控制台 → KV 存储 → 绑定命名空间 → 变量名填 `BOOKMARK_KV`
3. 控制台 → 项目设置 → 环境变量 → 添加 `AUTH_PASSWORD`
4. 构建命令留空，直接部署

## 配置确认

| 配置项 | 值 |
|--------|-----|
| Functions 目录 | `cloudone/` |
| KV 绑定变量名 | `BOOKMARK_KV` |
| 环境变量名 | `AUTH_PASSWORD` |
| 框架预设 | 无 / 静态 |
| 构建命令 | （留空） |

## 功能

- 密码验证后管理书签
- 私有/公开书签
- 置顶排序
- 自定义分类
- 搜索过滤
- 侧边栏分类筛选

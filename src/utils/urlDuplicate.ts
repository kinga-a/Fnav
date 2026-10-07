// 书签 URL 规范化：用于重复书签检测
// 判定规则（与需求约定一致）：
//  - 无协议时按 https:// 补全；http/https 视为不同链接（如需视为相同可去掉协议区分）
//  - 主机名转小写（A.CN 与 a.cn 视为相同）
//  - 去掉根路径的末尾斜杠（a.cn 与 a.cn/ 视为相同）
//  - 不去掉 www（a.cn 与 www.a.cn 视为不同链接）
//  - 保留路径与查询参数（a.cn 与 a.cn/foo 视为不同链接）
export function normalizeUrlForDedup(input: string): string {
  let raw = (input || '').trim();
  // 没有协议时按 https 补全，保证 a.cn 与 https://a.cn 判定一致
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    raw = 'https://' + raw;
  }
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    // 去掉默认端口，避免 a.cn:443 与 a.cn 被误判为不同链接
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    let href = u.href;
    // 仅当路径是根路径且无查询/锚点时去掉末尾斜杠
    if (u.pathname === '/' && !u.search && !u.hash) {
      href = href.replace(/\/$/, '');
    }
    return href;
  } catch {
    return raw.toLowerCase();
  }
}

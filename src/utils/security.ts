// 安全相关的工具函数

/**
 * 清理和验证用户输入，防止XSS攻击
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // 移除潜在的HTML标签
    .trim()
    .slice(0, 1000) // 限制长度
}

/**
 * 验证URL格式
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 生成安全的随机字符串
 */
export function generateSecureToken(length: number = 32): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 创建防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func.apply(null, args), delay)
  }
}

/**
 * 安全的JSON解析
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}

/**
 * 消毒 SVG 字符串，移除危险标签和属性，防止 XSS 攻击。
 * 用于 dangerouslySetInnerHTML 渲染用户自定义 SVG 图标。
 */
export function sanitizeSvg(svg: string): string {
  if (!svg || typeof svg !== 'string') return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');

    // 检查解析错误
    const parserError = doc.querySelector('parsererror');
    if (parserError) return '';

    // 移除危险标签
    const dangerousTags = ['script', 'foreignObject', 'use', 'image', 'iframe', 'object', 'embed'];
    dangerousTags.forEach(tag => {
      doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // 移除所有 on* 事件属性和 javascript: 协议
    doc.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'xlink:href') && value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        } else if (name === 'style' && /expression\s*\(/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    const svgEl = doc.querySelector('svg');
    return svgEl ? svgEl.outerHTML : '';
  } catch {
    return '';
  }
}

/**
 * 消毒内联 HTML，仅允许 <span style="..."> 标签。
 * 用于 MastodonTicker 等需要渲染少量内联样式的场景。
 */
export function sanitizeInlineHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';

  // HTML 实体常量（使用 \x26 避免 & 被编辑工具解码）
  const AMP = '\x26amp;';
  const LT = '\x26lt;';
  const GT = '\x26gt;';
  const QUOT = '\x26quot;';
  const APOS = '\x26#39;';

  // 将允许的 <span style="...">...</span> 临时占位
  const allowedSpans: string[] = [];
  let processed = html.replace(
    /<span\s+style="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi,
    (_match, style, content) => {
      // 过滤 style 中的危险内容
      const cleanStyle = String(style).replace(/expression\s*\(/gi, '').replace(/javascript:/gi, '');
      const placeholder = `\x00ALLOWED_${allowedSpans.length}\x00`;
      allowedSpans.push(`<span style="${cleanStyle}">${content}</span>`);
      return placeholder;
    }
  );

  // 转义所有剩余 HTML
  processed = processed
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, APOS);

  // 还原允许的 span
  allowedSpans.forEach((span, i) => {
    processed = processed.replace(`\x00ALLOWED_${i}\x00`, span);
  });

  return processed;
}

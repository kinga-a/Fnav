/**
 * 分类锚点跳转工具
 *
 * 修复移动端定位不准的问题：
 * 1. 使用 smooth 平滑跳转；
 * 2. 只执行一次平滑滚动，400ms 后校正一次——目标区块若处于按需渲染
 *    占位阶段，滚动会触发其激活、布局高度变化，校正后停在精确位置。
 *
 * 对齐规则：无论点击哪个分类（置顶网站 / 常用推荐 / 其他分类），
 * 分类标题都统一停在页面顶部固定头部（搜索栏）正下方同一高度，
 * 不再出现有的分类贴顶、有的分类停在 80px 处的不一致现象。
 */
export function scrollToCategory(categoryId: string) {
  const el = document.getElementById(`cat-${categoryId}`);
  if (!el) return;

  // 找到实际滚动容器（本项目布局中 main 是 overflow-y-auto 的滚动容器）
  const getContainer = (): HTMLElement | Window => {
    const main = document.querySelector('main');
    if (main) {
      const style = getComputedStyle(main);
      if (/(auto|scroll|overlay)/.test(style.overflowY)) return main;
    }
    return window;
  };

  // 顶部留白 = 固定头部（搜索栏）的高度；取不到时退回 scroll-mt-20 的 80px
  const getHeaderOffset = (): number => {
    const header = document.querySelector('header');
    if (header && getComputedStyle(header).position === 'fixed') {
      const h = header.getBoundingClientRect().height;
      if (h > 0) return h;
    }
    return 50;
  };

  const jump = () => {
    const container = getContainer();
    const offset = getHeaderOffset();

    if (container === window) {
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    } else {
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        offset;
      container.scrollTo({ top, behavior: 'smooth' });
    }
  };

  jump();
  // 目标区块若在按需渲染占位阶段，滚动会触发激活、高度变化；400ms 后校正一次到精确位置
  setTimeout(jump, 400);
}

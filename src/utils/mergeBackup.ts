import type { Category, LinkItem } from '../../types';

export type RestoreMode = 'merge' | 'overwrite';

export interface RestorePayload {
  links: LinkItem[];
  categories: Category[];
}

/**
 * 合并备份与本地数据：
 * - 分类按 id 去重，本地优先，备份中新增的分类追加
 * - 链接按 id 去重，本地优先，备份中新增的链接追加
 */
export function mergeBackup(
  localLinks: LinkItem[],
  localCategories: Category[],
  backupLinks: LinkItem[],
  backupCategories: Category[],
): RestorePayload {
  const categoryIds = new Set(localCategories.map((category) => category.id));
  const categories = [...localCategories];
  for (const category of backupCategories) {
    if (!category?.id || categoryIds.has(category.id)) continue;
    categoryIds.add(category.id);
    categories.push(category);
  }

  const linkIds = new Set(localLinks.map((link) => link.id));
  const links = [...localLinks];
  for (const link of backupLinks) {
    if (!link?.id || linkIds.has(link.id)) continue;
    linkIds.add(link.id);
    links.push(link);
  }

  return { links, categories };
}
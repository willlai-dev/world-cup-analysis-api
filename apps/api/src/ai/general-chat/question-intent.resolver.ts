import { Injectable } from '@nestjs/common';
import type {
  GeneralChatCategory,
  GeneralChatIntent,
  IntentResolution,
} from './general-chat.types';

/**
 * Keyword sets per category. Rule-based (spec §"Intent 判斷第一版請使用 rule-based");
 * deliberately no AI call here. Entries are matched case-insensitively as
 * substrings, so English keywords cover the lowercased question.
 */
const CATEGORY_KEYWORDS: Record<GeneralChatCategory, string[]> = {
  CHAMPION: [
    '冠軍',
    '奪冠',
    '封王',
    '金盃',
    '抱走',
    '熱門',
    '奪冠機率',
    '前三',
    '前五',
    '前幾',
    '排名',
    '誰會贏',
    'champion',
  ],
  MATCH: [
    '比賽',
    '賽事',
    '賽程',
    '對戰',
    '對決',
    '對陣',
    '對上',
    '迎戰',
    '交鋒',
    '交手',
    '面對',
    '出戰',
    '下一場',
    '接下來',
    '比分',
    '幾比幾',
    '戰績',
    '今天',
    '今日',
    '明天',
    '昨天',
    '開賽',
    '幾點',
    '淘汰賽',
    '小組賽',
    '上半場',
    '下半場',
    '延長賽',
    'match',
    ' vs ',
  ],
  TEAM: [
    '國家隊',
    '球隊',
    '隊伍',
    '戰力',
    '陣容',
    '教練',
    '分組',
    '小組',
    '晉級',
    '出線',
    '八強',
    '四強',
    'team',
  ],
  PLAYER: [
    '球員',
    '選手',
    '前鋒',
    '中場',
    '後衛',
    '門將',
    '守門員',
    '位置',
    '能力值',
    '能力',
    '評分',
    '評級',
    '身價',
    '狀態',
    '傷勢',
    '傷病',
    '受傷',
    '傷停',
    'player',
  ],
  NEWS: ['新聞', '消息', '報導', '報道', '動態', '頭條', '近況', 'news'],
};

/** Priority order used to name the single-category intent and the scope label. */
const CATEGORY_ORDER: GeneralChatCategory[] = ['CHAMPION', 'MATCH', 'TEAM', 'PLAYER', 'NEWS'];

/**
 * Classifies a general-chat question into data categories using keyword rules.
 * Zero DB / AI access — pure and cheap so it is trivially unit-testable.
 */
@Injectable()
export class QuestionIntentResolver {
  resolve(question: string): IntentResolution {
    const q = (question ?? '').toLowerCase();
    const categories = CATEGORY_ORDER.filter((cat) =>
      CATEGORY_KEYWORDS[cat].some((kw) => q.includes(kw.toLowerCase())),
    );
    return { intent: this.collapse(categories), categories };
  }

  private collapse(categories: GeneralChatCategory[]): GeneralChatIntent {
    if (categories.length === 0) return 'UNKNOWN';
    if (categories.length > 1) return 'MIXED_QUERY';
    return `${categories[0]}_QUERY` as GeneralChatIntent;
  }
}

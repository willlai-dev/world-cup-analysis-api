/**
 * FIFA code (tla) → 繁體中文國名。football-data 只回英文,故同步時用此表補 `nameZh`,
 * 讓前端可統一顯示中文。鍵為球隊三碼代碼(`Team.fifaCode`)。
 */
export const COUNTRY_NAME_ZH: Record<string, string> = {
  ALG: '阿爾及利亞',
  ARG: '阿根廷',
  AUS: '澳洲',
  AUT: '奧地利',
  BEL: '比利時',
  BIH: '波士尼亞與赫塞哥維納',
  BRA: '巴西',
  CAN: '加拿大',
  CPV: '維德角',
  COL: '哥倫比亞',
  COD: '剛果民主共和國',
  CRO: '克羅埃西亞',
  CUW: '古拉索',
  CZE: '捷克',
  ECU: '厄瓜多',
  EGY: '埃及',
  ENG: '英格蘭',
  FRA: '法國',
  GER: '德國',
  GHA: '迦納',
  HAI: '海地',
  IRN: '伊朗',
  IRQ: '伊拉克',
  CIV: '象牙海岸',
  JPN: '日本',
  JOR: '約旦',
  MEX: '墨西哥',
  MAR: '摩洛哥',
  NED: '荷蘭',
  NZL: '紐西蘭',
  NOR: '挪威',
  PAN: '巴拿馬',
  PAR: '巴拉圭',
  POR: '葡萄牙',
  QAT: '卡達',
  KSA: '沙烏地阿拉伯',
  SCO: '蘇格蘭',
  SEN: '塞內加爾',
  RSA: '南非',
  KOR: '南韓',
  ESP: '西班牙',
  SWE: '瑞典',
  SUI: '瑞士',
  TUN: '突尼西亞',
  TUR: '土耳其',
  USA: '美國',
  URU: '烏拉圭',
  UZB: '烏茲別克',
  // 常見備援(以防賽事擴充)
  ITA: '義大利',
  NGA: '奈及利亞',
  CMR: '喀麥隆',
  SRB: '塞爾維亞',
  POL: '波蘭',
  DEN: '丹麥',
  WAL: '威爾斯',
  CHI: '智利',
  PER: '秘魯',
  CRC: '哥斯大黎加',
};

/** Resolve 中文名 by fifaCode; undefined = leave existing/nameEn. */
export function countryNameZh(fifaCode?: string | null): string | undefined {
  if (!fifaCode) return undefined;
  return COUNTRY_NAME_ZH[fifaCode.toUpperCase()];
}

/**
 * FIFA code → 所屬聯會（AFC/CAF/CONCACAF/CONMEBOL/OFC/UEFA）。football-data 不回
 * 洲別，同步時用此表補 `Team.continent`；值與前端 /teams 洲別篩選選項一致。
 */
export const COUNTRY_CONFEDERATION: Record<string, string> = {
  // AFC
  AUS: 'AFC',
  IRN: 'AFC',
  IRQ: 'AFC',
  JPN: 'AFC',
  JOR: 'AFC',
  KOR: 'AFC',
  KSA: 'AFC',
  QAT: 'AFC',
  UZB: 'AFC',
  // CAF
  ALG: 'CAF',
  CIV: 'CAF',
  CMR: 'CAF',
  COD: 'CAF',
  CPV: 'CAF',
  EGY: 'CAF',
  GHA: 'CAF',
  MAR: 'CAF',
  NGA: 'CAF',
  RSA: 'CAF',
  SEN: 'CAF',
  TUN: 'CAF',
  // CONCACAF
  CAN: 'CONCACAF',
  CRC: 'CONCACAF',
  CUW: 'CONCACAF',
  HAI: 'CONCACAF',
  MEX: 'CONCACAF',
  PAN: 'CONCACAF',
  USA: 'CONCACAF',
  // CONMEBOL
  ARG: 'CONMEBOL',
  BRA: 'CONMEBOL',
  CHI: 'CONMEBOL',
  COL: 'CONMEBOL',
  ECU: 'CONMEBOL',
  PAR: 'CONMEBOL',
  PER: 'CONMEBOL',
  URU: 'CONMEBOL',
  // OFC
  NZL: 'OFC',
  // UEFA
  AUT: 'UEFA',
  BEL: 'UEFA',
  BIH: 'UEFA',
  CRO: 'UEFA',
  CZE: 'UEFA',
  DEN: 'UEFA',
  ENG: 'UEFA',
  ESP: 'UEFA',
  FRA: 'UEFA',
  GER: 'UEFA',
  ITA: 'UEFA',
  NED: 'UEFA',
  NOR: 'UEFA',
  POL: 'UEFA',
  POR: 'UEFA',
  SCO: 'UEFA',
  SRB: 'UEFA',
  SUI: 'UEFA',
  SWE: 'UEFA',
  TUR: 'UEFA',
  WAL: 'UEFA',
};

/** Resolve 聯會 by fifaCode; undefined = leave existing value. */
export function countryConfederation(fifaCode?: string | null): string | undefined {
  if (!fifaCode) return undefined;
  return COUNTRY_CONFEDERATION[fifaCode.toUpperCase()];
}

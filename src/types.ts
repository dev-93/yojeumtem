export interface Trend {
  keyword: string;
  approxTraffic: number;
  publishedAt: string;
  newsTitles: string[];
  url: string;
}

export interface ClassifiedTrend extends Trend {
  category: string;
  categoryCode: string;
  productFitScore: number;
  contentFitScore: number;
}

export interface ShoppingKeyword {
  keyword: string;
  category: string;
  categoryCode: string;
  productFitScore: number;
  contentFitScore: number;
}

export interface ShoppingSignal {
  keyword: string;
  categoryCode: string;
  startDate: string;
  endDate: string;
  recentAverage: number;
  priorAverage: number;
  changePercent: number | null;
  dataPoints: number;
  status: 'rising' | 'flat' | 'falling' | 'no_data';
}

export interface Candidate {
  product?: ProductObservation;
  rank: number;
  keyword: string;
  category: string;
  scores: {
    trendScore: number | null;
    shoppingScore: number | null;
    productFitScore: number;
    contentFitScore: number;
    totalScore: number;
  };
  google: Pick<Trend, 'approxTraffic' | 'publishedAt' | 'url' | 'newsTitles'> | null;
  shopping: ShoppingSignal | null;
}

export interface CandidateInput extends ShoppingKeyword {
  google: Trend | null;
  shopping: ShoppingSignal | null;
}

export interface Report {
  date: string;
  generatedAt: string;
  timezone: 'Asia/Seoul';
  sources: { google: string; naver: string };
  counts: {
    googleCollected: number;
    googleEligible: number;
    googleReview: number;
    naverQueried: number;
    naverWithData: number;
    ranked: number;
  };
  top3: Candidate[];
  top10: Candidate[];
  excluded: { keyword: string; source: 'Google' | 'Naver' | '점수' | '상품'; reason: string }[];
  review: { keyword: string; approxTraffic: number; publishedAt: string; newsTitles: string[]; reason: string }[];
  rawInput?: string;
  notes: string[];
}

// 수동으로 원문을 확인한 상품 관측. AI 점수나 검색량은 입력하지 않는다.
export interface ProductObservation {
  productKey: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  sourceUrl: string;
  source: 'official' | 'social';
  observedAt: string;
  verifiedAt: string;
  publishedAt: string | null;
  whyNow: string;
  distinctive: string;
  firstScene: string;
  visualBasis: string;
  purchaseUrl: string;
  purchaseStatus: 'available' | 'preorder' | 'funding';
}
